import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = await import('electron')
const mockNetFetch = vi.mocked(electron.net.fetch)

const { ATTACHMENT_DOWNLOAD_TIMEOUT_MS, downloadFileAsBase64, downloadImageAsBase64 } = await import(
  '../downloadAsBase64'
)

function mockResponse(body: string, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    headers: new Headers(headers),
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer)
  } as unknown as Response
}

describe('downloadAsBase64', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downloads images with a bounded fetch signal', async () => {
    mockNetFetch.mockResolvedValue(mockResponse('image-bytes', { 'content-type': 'image/png' }))

    const result = await downloadImageAsBase64('https://example.com/image.png')

    expect(result).toEqual({
      data: Buffer.from('image-bytes').toString('base64'),
      media_type: 'image/png'
    })
    expect(mockNetFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('uses the same timeout for file attachments', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    mockNetFetch.mockResolvedValue(mockResponse('file-bytes', { 'content-type': 'text/plain' }))

    const result = await downloadFileAsBase64('https://example.com/readme.txt', 'readme.txt')

    expect(result?.media_type).toBe('text/plain')
    expect(result?.data).toBe(Buffer.from('file-bytes').toString('base64'))
    expect(timeoutSpy).toHaveBeenCalledWith(ATTACHMENT_DOWNLOAD_TIMEOUT_MS)

    timeoutSpy.mockRestore()
  })
})
