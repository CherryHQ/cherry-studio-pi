import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadIpService() {
  vi.resetModules()
  return import('../ipService')
}

describe('ipService', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
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

  it('caches the CN fallback after an abort-like lookup failure', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new Error('This operation was aborted'))

    const { getIpCountry, isUserInChina } = await loadIpService()

    await expect(getIpCountry()).resolves.toBe('CN')
    await expect(getIpCountry()).resolves.toBe('CN')
    await expect(isUserInChina()).resolves.toBe(true)
    expect(net.fetch).toHaveBeenCalledTimes(1)
  })
})
