import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFiles } from '../useFiles'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options ? `${key}:${options.count}` : key)
  })
}))

vi.mock('@renderer/utils', () => ({
  filterSupportedFiles: vi.fn(async (files: FileMetadata[]) => files)
}))

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function createFile(path: string): FileMetadata {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    origin_name: path.split('/').pop() ?? path,
    path,
    size: 1,
    ext: `.${path.split('.').pop() ?? ''}`,
    type: FILE_TYPE.TEXT,
    created_at: '',
    count: 1
  } as FileMetadata
}

const selectFilesMock = vi.fn()

describe('useFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...window.api,
        file: {
          ...window.api?.file,
          select: selectFilesMock
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        info: vi.fn()
      }
    })
  })

  it('ignores duplicate file picker requests while a picker is open', async () => {
    const firstSelection = deferred<FileMetadata[] | null>()
    selectFilesMock.mockReturnValue(firstSelection.promise)
    const selectedFile = createFile('/tmp/a.txt')
    const { result } = renderHook(() => useFiles({ extensions: ['txt'] }))

    const firstPromise = result.current.onSelectFile({ multipleSelections: true })
    const secondPromise = result.current.onSelectFile({ multipleSelections: true })

    expect(selectFilesMock).toHaveBeenCalledTimes(1)
    await expect(secondPromise).resolves.toEqual([])

    await act(async () => {
      firstSelection.resolve([selectedFile])
      await firstPromise
    })

    expect(result.current.files).toEqual([selectedFile])
    expect(result.current.selecting).toBe(false)
  })

  it('clears selecting when the native picker rejects', async () => {
    selectFilesMock.mockRejectedValueOnce(new Error('dialog failed'))
    const { result } = renderHook(() => useFiles({ extensions: ['txt'] }))

    await act(async () => {
      await expect(result.current.onSelectFile({ multipleSelections: false })).rejects.toThrow('dialog failed')
    })

    expect(result.current.selecting).toBe(false)
  })

  it('ignores late picker results after unmount', async () => {
    const selection = deferred<FileMetadata[] | null>()
    selectFilesMock.mockReturnValue(selection.promise)
    const selectedFile = createFile('/tmp/late.txt')
    const { result, unmount } = renderHook(() => useFiles({ extensions: ['txt'] }))

    const selectPromise = result.current.onSelectFile({ multipleSelections: true })
    await waitFor(() => expect(selectFilesMock).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      selection.resolve([selectedFile])
      await expect(selectPromise).resolves.toEqual([])
    })

    expect(window.toast.info).not.toHaveBeenCalled()
  })
})
