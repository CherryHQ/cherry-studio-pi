import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReduxExporter } from '../ReduxExporter'

const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarn
    })
  }
}))

describe('ReduxExporter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    loggerWarn.mockClear()
    localStorage.clear()
  })

  it('exports available Redux Persist slices', () => {
    localStorage.setItem(
      'persist:cherry-studio',
      JSON.stringify({
        settings: JSON.stringify({ theme: 'dark' }),
        llm: JSON.stringify({ providers: [{ id: 'openai' }] }),
        _persist: JSON.stringify({ version: 1, rehydrated: true })
      })
    )

    const result = new ReduxExporter().export()

    expect(result.data).toMatchObject({
      settings: { theme: 'dark' },
      llm: { providers: [{ id: 'openai' }] },
      _persist: { version: 1, rehydrated: true }
    })
    expect(result.slicesFound).toEqual(['settings', 'llm'])
    expect(result.slicesMissing).toContain('assistants')
  })

  it('returns an empty export when localStorage reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    const exporter = new ReduxExporter()

    expect(exporter.export()).toMatchObject({
      data: {},
      slicesFound: []
    })
    expect(exporter.getRawData()).toBeNull()
    expect(exporter.hasData()).toBe(false)
    expect(exporter.getPersistedSlices()).toEqual([])
    expect(loggerWarn).toHaveBeenCalledWith(
      'ReduxExporter.export: Failed to read localStorage item persist:cherry-studio',
      expect.objectContaining({ name: 'SecurityError' })
    )
  })
})
