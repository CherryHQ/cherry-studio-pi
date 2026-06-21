import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageViewer, { getImageBlobFromSource } from '../ImageViewer'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  convertImageToPng: vi.fn(),
  fetch: vi.fn(),
  fsRead: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn()
  },
  clipboard: {
    write: vi.fn(),
    writeText: vi.fn()
  }
}))

vi.mock('@renderer/utils/download', () => ({
  download: mocks.download
}))

vi.mock('@renderer/utils/image', () => ({
  convertImageToPng: mocks.convertImageToPng
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

class MockClipboardItem {
  items: Record<string, Blob>

  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.convertImageToPng.mockImplementation(async (blob: Blob) => blob)
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['remote'], { type: 'image/webp' })
    })
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))

    Object.assign(window, {
      api: { fs: { read: mocks.fsRead } },
      toast: mocks.toast
    })
    Object.assign(navigator, { clipboard: mocks.clipboard })
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('opens the shared preview dialog when clicked', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.getByTestId('image-preview-dialog')).toBeInTheDocument()
  })

  it('respects preview=false', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" preview={false} />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.queryByTestId('image-preview-dialog')).not.toBeInTheDocument()
  })

  it('copies image source from the context menu', async () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.copy.src' }))

    await waitFor(() => {
      expect(mocks.clipboard.writeText).toHaveBeenCalledWith('https://example.com/image.png')
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('copies image source even when toast is not available', async () => {
    Object.assign(window, { toast: undefined })

    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.copy.src' }))

    await waitFor(() => {
      expect(mocks.clipboard.writeText).toHaveBeenCalledWith('https://example.com/image.png')
    })
  })

  it('copies image data from the context menu', async () => {
    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(mocks.convertImageToPng).toHaveBeenCalled()
    })
    expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    expect(mocks.toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('ignores delayed copy source feedback after unmount', async () => {
    const runningCopy = deferred<void>()
    mocks.clipboard.writeText.mockReturnValueOnce(runningCopy.promise)
    const { unmount } = render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.copy.src' }))
    unmount()

    await act(async () => {
      runningCopy.resolve()
      await runningCopy.promise
    })

    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('ignores delayed copy image feedback after unmount', async () => {
    const runningCopy = deferred<void>()
    mocks.clipboard.write.mockReturnValueOnce(runningCopy.promise)
    const { unmount } = render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    await waitFor(() => {
      expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    })
    unmount()

    await act(async () => {
      runningCopy.resolve()
      await runningCopy.promise
    })

    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('downloads the image from the context menu', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.download' }))

    expect(mocks.download).toHaveBeenCalledWith('https://example.com/image.png')
  })

  it('reads image blobs from data URLs', async () => {
    const blob = await getImageBlobFromSource('data:image/png;base64,aGVsbG8=')

    expect(blob.type).toBe('image/png')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.fsRead).not.toHaveBeenCalled()
  })

  it('reads image blobs from file URLs', async () => {
    const blob = await getImageBlobFromSource('file:///tmp/example.png')

    expect(mocks.fsRead).toHaveBeenCalledWith('file:///tmp/example.png')
    expect(blob.type).toBe('image/png')
  })

  it('reads image blobs from remote URLs', async () => {
    const blob = await getImageBlobFromSource('https://example.com/image.webp')

    expect(mocks.fetch).toHaveBeenCalledWith('https://example.com/image.webp', {
      signal: expect.any(AbortSignal)
    })
    expect(blob.type).toBe('image/webp')
  })

  it('rejects failed remote image responses before copying/downloading blobs', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob(['not found'], { type: 'text/html' })
    })

    await expect(getImageBlobFromSource('https://example.com/missing.png')).rejects.toThrow(
      'Failed to fetch image: HTTP 404'
    )
  })
})
