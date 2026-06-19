import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSaveFailedToast } from '../useSaveFailedToast'

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => `${prefix}: failed`
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

describe('useSaveFailedToast', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('shows save errors while mounted', () => {
    const { result } = renderHook(() => useSaveFailedToast())

    result.current(new Error('write failed'))

    expect(window.toast.error).toHaveBeenCalledWith('common.save_failed: failed')
  })

  it('ignores stale save errors after unmount', () => {
    const { result, unmount } = renderHook(() => useSaveFailedToast())
    const showSaveFailed = result.current

    unmount()
    showSaveFailed(new Error('write failed'))

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('supports custom message keys', () => {
    const { result } = renderHook(() => useSaveFailedToast('custom.save_failed'))

    result.current(new Error('write failed'))

    expect(window.toast.error).toHaveBeenCalledWith('custom.save_failed: failed')
  })
})
