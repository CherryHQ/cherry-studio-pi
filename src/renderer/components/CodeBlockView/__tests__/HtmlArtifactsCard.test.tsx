import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'

const mockCreateTempFile = vi.fn()
const mockWrite = vi.fn()
const mockOpenPath = vi.fn()
const mockOpenExternal = vi.fn()
const mockSave = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('../HtmlArtifactsPopup', () => ({
  default: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.artifacts.button.openExternal': 'Open external',
        'chat.artifacts.button.download': 'Download',
        'chat.artifacts.button.preview': 'Preview',
        'chat.artifacts.preview.openExternal.error.content': 'Open failed',
        'message.download.success': 'Downloaded'
      }
      return map[key] ?? key
    }
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

describe('HtmlArtifactsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mockWrite.mockResolvedValue(undefined)
    mockOpenPath.mockResolvedValue(undefined)
    mockOpenExternal.mockResolvedValue(undefined)
    ;(window as any).api = {
      ...(window.api as any),
      file: {
        ...(window.api as any)?.file,
        createTempFile: mockCreateTempFile,
        write: mockWrite,
        openPath: mockOpenPath,
        save: mockSave
      },
      shell: {
        openExternal: mockOpenExternal
      }
    }
    ;(window as any).toast = {
      ...(window.toast as any),
      error: mockToastError,
      success: mockToastSuccess
    }
  })

  it('opens generated HTML artifacts through the file API', async () => {
    const html = '<html><head><title>Demo</title></head><body>Hello</body></html>'
    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByText('Open external'))

    await waitFor(() => expect(mockOpenPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html'))
    expect(mockCreateTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mockWrite).toHaveBeenCalledWith('/tmp/artifacts-preview.html', html)
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('shows a toast when external artifact opening fails', async () => {
    mockOpenPath.mockRejectedValueOnce(new Error('open failed'))
    render(<HtmlArtifactsCard html="<html><body>Hello</body></html>" />)

    fireEvent.click(screen.getByText('Open external'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Open failed'))
  })

  it('shows a toast when artifact download fails', async () => {
    mockSave.mockRejectedValueOnce(new Error('save failed'))
    render(<HtmlArtifactsCard html="<html><head><title>Demo</title></head><body>Hello</body></html>" />)

    fireEvent.click(screen.getByText('code_block.download.label'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.save_failed: save failed'))
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('ignores artifact download failures after unmount', async () => {
    const saveOperation = deferred<string | null>()
    mockSave.mockReturnValueOnce(saveOperation.promise)
    const { unmount } = render(
      <HtmlArtifactsCard html="<html><head><title>Demo</title></head><body>Hello</body></html>" />
    )

    fireEvent.click(screen.getByText('code_block.download.label'))

    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('save failed after unmount'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
