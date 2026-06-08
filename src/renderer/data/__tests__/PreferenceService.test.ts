import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/PreferenceService')

const { debugMock, errorMock, verboseMock } = vi.hoisted(() => ({
  debugMock: vi.fn(),
  errorMock: vi.fn(),
  verboseMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: debugMock,
      error: errorMock,
      info: vi.fn(),
      verbose: verboseMock,
      warn: vi.fn()
    })
  }
}))

describe('PreferenceService', () => {
  let onChangedHandler: ((key: string, value: unknown) => void) | undefined
  let cleanupMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    onChangedHandler = undefined
    cleanupMock = vi.fn()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preference: {
          get: vi.fn(),
          getAll: vi.fn(),
          getMultipleRaw: vi.fn(),
          onChanged: vi.fn((handler: (key: string, value: unknown) => void) => {
            onChangedHandler = handler
            return cleanupMock
          }),
          set: vi.fn(),
          setMultiple: vi.fn(),
          subscribe: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not write preference values to change debug logs', async () => {
    const { preferenceService } = await import('@data/PreferenceService')

    onChangedHandler?.('data.backup.webdav.pass', {
      apiKey: 'sk-secret-value',
      password: 'webdav-secret-password',
      token: 'oauth-secret-token'
    })

    const serializedLogs = debugMock.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(serializedLogs).toContain('data.backup.webdav.pass')
    expect(serializedLogs).toContain('"valueType":"object"')
    expect(serializedLogs).toContain('"hasValue":true')
    expect(serializedLogs).not.toContain('sk-secret-value')
    expect(serializedLogs).not.toContain('webdav-secret-password')
    expect(serializedLogs).not.toContain('oauth-secret-token')

    preferenceService.cleanup()
    expect(cleanupMock).toHaveBeenCalled()
  })
})
