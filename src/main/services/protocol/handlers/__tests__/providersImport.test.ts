import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, settingsWindowServiceMock } = vi.hoisted(() => {
  const settingsWindowServiceMock = {
    open: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'SettingsWindowService') return settingsWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, loggerMock, settingsWindowServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import {
  handleProvidersProtocolUrl,
  parseProvidersImportData,
  PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS
} from '../providersImport'

const toUrlSafeBase64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf-8').toString('base64').replaceAll('+', '_').replaceAll('/', '-')

describe('providersImport protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens provider settings with decoded provider import data', async () => {
    const config = {
      id: 'custom-openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      name: 'Custom OpenAI',
      type: 'openai'
    }
    const data = toUrlSafeBase64(config)

    await handleProvidersProtocolUrl(new URL(`cherrystudio://providers/api-keys?v=1&data=${data}`))

    expect(settingsWindowServiceMock.open).toHaveBeenCalledWith(
      `/settings/provider?addProviderData=${encodeURIComponent(JSON.stringify(config))}`
    )
    expect(JSON.stringify(loggerMock.debug.mock.calls)).not.toContain('sk-test')
  })

  it('does not open settings when provider import data is invalid', async () => {
    await handleProvidersProtocolUrl(new URL('cherrystudio://providers/api-keys?v=1&data=not-json'))

    expect(settingsWindowServiceMock.open).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it('rejects oversized provider import payloads before decoding', async () => {
    const oversizedPayload = 'A'.repeat(PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS + 1)

    expect(parseProvidersImportData(oversizedPayload)).toBeNull()
    await handleProvidersProtocolUrl(new URL(`cherrystudio://providers/api-keys?v=1&data=${oversizedPayload}`))

    expect(settingsWindowServiceMock.open).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('too large'),
      expect.objectContaining({
        maxValueChars: PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS
      })
    )
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain(oversizedPayload)
  })

  it('preserves standard base64 plus and slash characters through URL parsing', async () => {
    const config = { id: 'custom-openai', apiKey: 'sk-1919-Ͽ' }
    const data = Buffer.from(JSON.stringify(config), 'utf-8').toString('base64')

    expect(data).toContain('+')
    expect(data).toContain('/')

    await handleProvidersProtocolUrl(new URL(`cherrystudio://providers/api-keys?v=1&data=${data}`))

    expect(settingsWindowServiceMock.open).toHaveBeenCalledWith(
      `/settings/provider?addProviderData=${encodeURIComponent(JSON.stringify(config))}`
    )
  })

  it('parses wrapped legacy provider import payloads', () => {
    const payload = Buffer.from("({'id':'custom-openai'})", 'utf-8').toString('base64')

    expect(parseProvidersImportData(payload)).toBe(JSON.stringify({ id: 'custom-openai' }))
  })

  it('parses URL-safe base64 provider import payloads directly', () => {
    const config = { id: 'tokenflux', apiKey: 'sk-10895-Ͽ' }
    const payload = toUrlSafeBase64(config)

    expect(payload).toContain('_')
    expect(payload).toContain('-')
    expect(parseProvidersImportData(payload)).toBe(JSON.stringify(config))
  })

  it('preserves apostrophes and parentheses in standard JSON payload strings', () => {
    const config = {
      id: 'custom',
      name: "Bob's Provider (prod)",
      apiKey: "sk-live-it's-real-(primary)"
    }
    const payload = Buffer.from(JSON.stringify(config), 'utf-8').toString('base64')

    expect(parseProvidersImportData(payload)).toBe(JSON.stringify(config))
  })

  it('parses legacy single-quoted strings without stripping value characters', () => {
    const payload = Buffer.from("({'id':'tokenflux','name':'Bob\\'s Provider (prod)'})", 'utf-8').toString('base64')

    expect(parseProvidersImportData(payload)).toBe(
      JSON.stringify({
        id: 'tokenflux',
        name: "Bob's Provider (prod)"
      })
    )
  })

  it('logs unknown provider protocol URLs without raw query payloads', async () => {
    await handleProvidersProtocolUrl(new URL('cherrystudio://providers/unknown?data=sk-secret-token#raw-secret'))

    const logs = JSON.stringify(loggerMock.error.mock.calls)
    expect(logs).toContain('Unknown providers protocol URL')
    expect(logs).not.toContain('sk-secret-token')
    expect(logs).not.toContain('raw-secret')
  })
})
