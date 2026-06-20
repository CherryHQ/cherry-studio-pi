import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExportFetchInit, EXPORT_FETCH_TIMEOUT_MS, fetchExportResource } from '../exportFetch'

describe('exportFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds the default export timeout signal', () => {
    const timeoutSignal = new AbortController().signal
    vi.spyOn(globalThis.AbortSignal, 'timeout').mockReturnValue(timeoutSignal)

    const init = createExportFetchInit({ method: 'POST' })

    expect(globalThis.AbortSignal.timeout).toHaveBeenCalledWith(EXPORT_FETCH_TIMEOUT_MS)
    expect(init).toMatchObject({ method: 'POST' })
    expect(init.signal).toBe(timeoutSignal)
  })

  it('combines caller abort signals with the export timeout', () => {
    const callerSignal = new AbortController().signal
    const timeoutSignal = new AbortController().signal
    const combinedSignal = new AbortController().signal
    vi.spyOn(globalThis.AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    vi.spyOn(globalThis.AbortSignal, 'any').mockReturnValue(combinedSignal)

    const init = createExportFetchInit({ signal: callerSignal })

    expect(globalThis.AbortSignal.any).toHaveBeenCalledWith([callerSignal, timeoutSignal])
    expect(init.signal).toBe(combinedSignal)
  })

  it('uses the timeout-aware init for export fetches', async () => {
    const timeoutSignal = new AbortController().signal
    const response = new Response('{}')
    vi.spyOn(globalThis.AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

    await expect(fetchExportResource('https://example.com/export', { method: 'PUT' })).resolves.toBe(response)

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/export', {
      method: 'PUT',
      signal: timeoutSignal
    })
  })
})
