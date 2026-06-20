import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../tests/__mocks__/MainLoggerService'

const electron = await import('electron')
const mockNetFetch = vi.mocked(electron.net.fetch)

const { ATTACHMENT_DOWNLOAD_TIMEOUT_MS, MAX_FILE_SIZE_BYTES, downloadFileAsBase64, downloadImageAsBase64 } =
  await import('../downloadAsBase64')

function mockResponse(body: string, headers: Record<string, string> = {}, ok = true, status = 200) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok,
    status,
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

  it('cancels streamed attachment downloads before buffering bodies over the size limit', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const arrayBuffer = vi.fn()
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: { byteLength: MAX_FILE_SIZE_BYTES + 1 }
      }),
      cancel,
      releaseLock
    }
    mockNetFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: {
        getReader: () => reader
      },
      arrayBuffer
    } as unknown as Response)

    await expect(downloadImageAsBase64('https://example.com/huge.png')).resolves.toBeNull()

    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Image too large after download', {
      url: {
        type: 'url',
        protocol: 'https:',
        host: 'example.com',
        pathnameLength: 9,
        searchLength: 0,
        hashLength: 0,
        hasSearch: false,
        hasHash: false
      },
      size: MAX_FILE_SIZE_BYTES + 1
    })
  })

  it('summarizes failed image URLs without logging query or hash secrets', async () => {
    mockNetFetch.mockResolvedValue(mockResponse('', {}, false, 403))

    await expect(downloadImageAsBase64('https://example.com/image.png?token=abc#secret')).resolves.toBeNull()

    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('token=abc')
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('#secret')
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Failed to download image', {
      url: {
        type: 'url',
        protocol: 'https:',
        host: 'example.com',
        pathnameLength: 10,
        searchLength: 10,
        hashLength: 7,
        hasSearch: true,
        hasHash: true
      },
      status: 403
    })
  })

  it('summarizes failed file URLs without logging query or hash secrets', async () => {
    mockNetFetch.mockRejectedValue(new Error('network failed'))

    await expect(
      downloadFileAsBase64('https://example.com/report.pdf?token=abc#secret', 'report.pdf')
    ).resolves.toBeNull()

    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('token=abc')
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('#secret')
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Failed to fetch file', {
      url: {
        type: 'url',
        protocol: 'https:',
        host: 'example.com',
        pathnameLength: 11,
        searchLength: 10,
        hashLength: 7,
        hasSearch: true,
        hasHash: true
      },
      filename: 'report.pdf',
      error: 'network failed'
    })
  })
})
