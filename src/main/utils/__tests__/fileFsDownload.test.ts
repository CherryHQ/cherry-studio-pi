import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { download } from '../file/fs'

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

function mockResponse(body: string, headers: Record<string, string> = {}, ok = true, status = 200): Response {
  const bytes = new TextEncoder().encode(body)

  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Forbidden',
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      }
    })
  } as Response
}

function mockOversizedStreamResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue({ byteLength: MAX_DOWNLOAD_BYTES + 1 } as unknown as Uint8Array<ArrayBuffer>)
      }
    })
  } as Response
}

async function expectMissing(filePath: string): Promise<void> {
  await expect(access(filePath)).rejects.toThrow()
}

describe('utils/file/fs download', () => {
  let root: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'file-fs-download-'))
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
  })

  it('downloads a public remote file atomically', async () => {
    fetchMock.mockResolvedValue(mockResponse('hello remote file', { 'content-type': 'text/plain' }))
    const dest = path.join(root, 'download.txt') as FilePath

    await download('https://example.com/download.txt', dest)

    expect(await readFile(dest, 'utf8')).toBe('hello remote file')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/download.txt',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('rejects private URLs before fetching', async () => {
    const dest = path.join(root, 'private.txt') as FilePath

    await expect(download('http://127.0.0.1:8080/private.txt', dest)).rejects.toThrow('Unsafe remote url')

    expect(fetchMock).not.toHaveBeenCalled()
    await expectMissing(dest)
  })

  it('rejects oversized downloads from content-length before writing', async () => {
    fetchMock.mockResolvedValue(mockResponse('', { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) }))
    const dest = path.join(root, 'huge.txt') as FilePath

    await expect(download('https://example.com/huge.txt', dest)).rejects.toThrow('remote file is too large')

    await expectMissing(dest)
  })

  it('rejects oversized downloads while streaming when content-length is missing', async () => {
    fetchMock.mockResolvedValue(mockOversizedStreamResponse())
    const dest = path.join(root, 'streaming-huge.txt') as FilePath

    await expect(download('https://example.com/streaming-huge.txt', dest)).rejects.toThrow('remote file is too large')

    await expectMissing(dest)
  })
})
