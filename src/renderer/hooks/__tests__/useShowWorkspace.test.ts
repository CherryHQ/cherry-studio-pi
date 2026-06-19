import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useShowWorkspace } from '../useShowWorkspace'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useShowWorkspace', () => {
  const toastErrorMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    Object.assign(window, {
      toast: {
        ...window.toast,
        error: toastErrorMock
      }
    })
  })

  it('toggles workspace visibility from the current preference value', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.show_workspace', false)

    const { result } = renderHook(() => useShowWorkspace())

    act(() => {
      result.current.toggleShowWorkspace()
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.show_workspace')).toBe(true)
    })
  })

  it('shows an error toast when workspace visibility persistence fails', async () => {
    MockUsePreferenceUtils.mockPreferenceReturn(
      'feature.notes.show_workspace',
      false,
      vi.fn().mockRejectedValue(new Error('persist failed'))
    )

    const { result } = renderHook(() => useShowWorkspace())

    act(() => {
      result.current.toggleShowWorkspace()
    })

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('notes.settings.save_failed: persist failed')
    })
  })

  it('ignores stale workspace visibility persistence failures after unmount', async () => {
    const save = deferred()
    MockUsePreferenceUtils.mockPreferenceReturn(
      'feature.notes.show_workspace',
      false,
      vi.fn().mockReturnValue(save.promise)
    )

    const { result, unmount } = renderHook(() => useShowWorkspace())

    act(() => {
      result.current.toggleShowWorkspace()
    })

    unmount()

    await act(async () => {
      save.reject(new Error('late failure'))
      await save.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
