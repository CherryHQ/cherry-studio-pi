import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadIpService() {
  vi.resetModules()
  return import('../ipService')
}

describe('ipService', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates concurrent and repeated country lookups within the process', async () => {
    vi.mocked(net.fetch).mockResolvedValue({
      json: vi.fn(async () => ({ country_code: 'US' }))
    } as unknown as Response)

    const { getIpCountry, isUserInChina } = await loadIpService()
    const [first, second] = await Promise.all([getIpCountry(), getIpCountry()])

    expect(first).toBe('US')
    expect(second).toBe('US')
    expect(await getIpCountry()).toBe('US')
    expect(await isUserInChina()).toBe(false)
    expect(net.fetch).toHaveBeenCalledTimes(1)
  })

  it('short-caches the CN fallback after an abort-like lookup failure and retries later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.mocked(net.fetch)
      .mockRejectedValueOnce(new Error('This operation was aborted'))
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ country_code: 'US' }))
      } as unknown as Response)

    const { getIpCountry, isUserInChina } = await loadIpService()

    await expect(getIpCountry()).resolves.toBe('CN')
    await expect(getIpCountry()).resolves.toBe('CN')
    await expect(isUserInChina()).resolves.toBe(true)
    expect(net.fetch).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:06:00.000Z'))

    await expect(getIpCountry()).resolves.toBe('US')
    await expect(isUserInChina()).resolves.toBe(false)
    expect(net.fetch).toHaveBeenCalledTimes(2)
  })
})
