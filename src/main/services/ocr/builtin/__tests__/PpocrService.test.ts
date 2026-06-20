import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadOcrImageMock } = vi.hoisted(() => ({
  loadOcrImageMock: vi.fn()
}))

vi.mock('@main/utils/ocr', () => ({
  loadOcrImage: loadOcrImageMock
}))

const electron = await import('electron')
const mockNetFetch = vi.mocked(electron.net.fetch)

const { PPOCR_REQUEST_TIMEOUT_MS, PpocrService } = await import('../PpocrService')

const imageFile = {
  id: 'image-1',
  name: 'scan',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 12,
  ext: '.png',
  type: 'image',
  created_at: '2026-01-01T00:00:00.000Z',
  count: 1
}

describe('PpocrService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadOcrImageMock.mockResolvedValue(Buffer.from('image-bytes'))
  })

  it('sends OCR requests with a bounded timeout signal', async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    mockNetFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: {
          ocrResults: [
            {
              prunedResult: {
                rec_texts: ['hello', 'world']
              }
            }
          ]
        }
      })
    } as unknown as Response)

    const service = new PpocrService()
    const result = await service.ocr(imageFile as never, {
      apiUrl: 'https://ocr.example/api',
      accessToken: 'ocr-token'
    })

    expect(result.text).toBe('hello\nworld')
    expect(timeoutSpy).toHaveBeenCalledWith(PPOCR_REQUEST_TIMEOUT_MS)
    expect(mockNetFetch).toHaveBeenCalledWith(
      'https://ocr.example/api',
      expect.objectContaining({
        method: 'POST',
        signal: timeoutSignal,
        headers: expect.objectContaining({
          Authorization: 'token ocr-token'
        })
      })
    )

    timeoutSpy.mockRestore()
  })

  it('does not expose OCR error response bodies', async () => {
    mockNetFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: vi.fn().mockResolvedValue('sensitive recognized text and base64 payload')
    } as unknown as Response)

    const service = new PpocrService()

    let thrown: unknown
    try {
      await service.ocr(imageFile as never, {
        apiUrl: 'https://ocr.example/api',
        accessToken: 'ocr-token'
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('OCR service returned HTTP 500 Internal Server Error')
    expect((thrown as Error).message).toContain('body length:')
    expect((thrown as Error).message).not.toContain('sensitive recognized text')
    expect((thrown as Error).message).not.toContain('base64 payload')
  })

  it('caps streamed OCR error responses before diagnostics', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(5000)))
      },
      cancel
    })
    mockNetFetch.mockResolvedValue(new Response(stream, { status: 500, statusText: 'Internal Server Error' }))

    const service = new PpocrService()

    await expect(
      service.ocr(imageFile as never, {
        apiUrl: 'https://ocr.example/api',
        accessToken: 'ocr-token'
      })
    ).rejects.toThrow('OCR service returned HTTP 500 Internal Server Error (body length: 4096+)')
    expect(cancel).toHaveBeenCalled()
  })
})
