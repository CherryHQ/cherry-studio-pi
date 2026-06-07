import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = await import('electron')
const mockNetFetch = vi.fn()
vi.mocked(electron.net.fetch).mockImplementation(mockNetFetch)

const { Fetcher, MCP_FETCH_TIMEOUT_MS } = await import('../fetch')

describe('MCP fetch server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('passes a timeout signal to network fetches', async () => {
    mockNetFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<html>ok</html>')
    })

    const result = await Fetcher.html({ url: 'https://example.com' })

    expect(result.isError).toBe(false)
    expect(mockNetFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('returns an error instead of hanging when the remote page stalls', async () => {
    vi.useFakeTimers()
    mockNetFetch.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const resultPromise = Fetcher.html({ url: 'https://example.com' })
    await vi.advanceTimersByTimeAsync(MCP_FETCH_TIMEOUT_MS)
    const result = await resultPromise

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('timed out')

    vi.useRealTimers()
  })
})
