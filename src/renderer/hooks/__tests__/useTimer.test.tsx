import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimer } from '../useTimer'

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops completed timeout timers from internal tracking', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const callback = vi.fn()
    const { result } = renderHook(() => useTimer())

    act(() => {
      result.current.setTimeoutTimer('done', callback, 100)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(callback).toHaveBeenCalledTimes(1)
    const clearCallsAfterFire = clearTimeoutSpy.mock.calls.length

    act(() => {
      result.current.clearTimeoutTimer('done')
    })

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(clearCallsAfterFire)
  })

  it('clears only the previous timer when resetting the same key', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useTimer())

    act(() => {
      result.current.setTimeoutTimer('replace', first, 100)
      result.current.setTimeoutTimer('replace', second, 100)
    })

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
