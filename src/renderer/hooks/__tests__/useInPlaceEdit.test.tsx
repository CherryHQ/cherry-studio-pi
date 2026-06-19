import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInPlaceEdit } from '../useInPlaceEdit'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
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

function changeValue(
  result: ReturnType<typeof renderHook<ReturnType<typeof useInPlaceEdit>, unknown>>['result'],
  value: string
) {
  act(() => {
    result.current.inputProps.onChange?.({ target: { value } } as React.ChangeEvent<HTMLInputElement>)
  })
}

describe('useInPlaceEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError
      }
    })
  })

  it('saves changed values and closes the editor', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useInPlaceEdit({ onSave }))

    act(() => {
      result.current.startEdit('Original')
    })
    changeValue(result, ' Updated ')

    await act(async () => {
      await (result.current.saveEdit() as unknown as Promise<void>)
    })

    expect(onSave).toHaveBeenCalledWith('Updated')
    expect(result.current.isEditing).toBe(false)
    expect(result.current.isSaving).toBe(false)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps the editor open and shows a save error when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useInPlaceEdit({ onSave }))

    act(() => {
      result.current.startEdit('Original')
    })
    changeValue(result, 'Updated')

    await act(async () => {
      await (result.current.saveEdit() as unknown as Promise<void>)
    })

    expect(result.current.isEditing).toBe(true)
    expect(result.current.isSaving).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith('common.save_failed: disk full')
  })

  it('uses a custom save error handler while mounted', async () => {
    const error = new Error('permission denied')
    const onError = vi.fn()
    const onSave = vi.fn().mockRejectedValue(error)
    const { result } = renderHook(() => useInPlaceEdit({ onSave, onError }))

    act(() => {
      result.current.startEdit('Original')
    })
    changeValue(result, 'Updated')

    await act(async () => {
      await (result.current.saveEdit() as unknown as Promise<void>)
    })

    expect(onError).toHaveBeenCalledWith(error)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('ignores stale save failures after unmount', async () => {
    const save = deferred()
    const onError = vi.fn()
    const onSave = vi.fn(() => save.promise)
    const { result, unmount } = renderHook(() => useInPlaceEdit({ onSave, onError }))

    act(() => {
      result.current.startEdit('Original')
    })
    changeValue(result, 'Updated')

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.saveEdit() as unknown as Promise<void>
    })

    unmount()

    await act(async () => {
      save.reject(new Error('late failure'))
      await savePromise
    })

    expect(onError).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
