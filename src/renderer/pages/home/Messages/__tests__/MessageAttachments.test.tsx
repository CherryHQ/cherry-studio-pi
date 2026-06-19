import type { FileMetadata } from '@renderer/types/file'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MessageAttachments from '../MessageAttachments'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  preview: vi.fn(),
  toastError: vi.fn()
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({
    preview: mocks.preview
  })
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    getSafePath: (file: FileMetadata) => file.path,
    formatFileName: (file: FileMetadata) => file.origin_name
  }
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '1 KB',
  parseFileTypes: () => 'document'
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const createFile = (): FileMetadata =>
  ({
    id: 'file-1',
    name: 'demo.pdf',
    origin_name: 'demo.pdf',
    path: '/tmp/demo.pdf',
    size: 1024,
    ext: '.pdf',
    type: 'document',
    created_at: '2026-06-19T00:00:00.000Z',
    count: 1
  }) as FileMetadata

describe('MessageAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: mocks.openPath
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError
      }
    })
  })

  it('shows an error when opening an attachment fails', async () => {
    mocks.openPath.mockRejectedValueOnce(new Error('open failed'))

    render(<MessageAttachments file={createFile()} />)

    fireEvent.click(screen.getByText('files.open'))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('common.operation_failed: open failed'))
  })

  it('ignores attachment open failures after unmount', async () => {
    const openOperation = deferred<void>()
    mocks.openPath.mockReturnValueOnce(openOperation.promise)
    const { unmount } = render(<MessageAttachments file={createFile()} />)

    fireEvent.click(screen.getByText('files.open'))

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/demo.pdf'))
    unmount()

    await act(async () => {
      openOperation.reject(new Error('open failed after unmount'))
      await openOperation.promise.catch(() => undefined)
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
