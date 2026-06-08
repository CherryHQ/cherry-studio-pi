import { cacheService } from '@data/CacheService'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import useScrollPosition from '../useScrollPosition'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(() => 0),
    setCasual: vi.fn()
  }
}))

vi.mock('../useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

describe('useScrollPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the throttled scroll handler stable across ordinary rerenders', () => {
    const { result, rerender } = renderHook(({ scrollKey }) => useScrollPosition(scrollKey), {
      initialProps: { scrollKey: 'topics' }
    })

    const firstHandleScroll = result.current.handleScroll

    rerender({ scrollKey: 'topics' })

    expect(result.current.handleScroll).toBe(firstHandleScroll)
  })

  it('rebuilds the throttled scroll handler when the wait time changes', () => {
    const { result, rerender } = renderHook(({ wait }) => useScrollPosition('topics', wait), {
      initialProps: { wait: 100 }
    })

    const firstHandleScroll = result.current.handleScroll

    rerender({ wait: 250 })

    expect(result.current.handleScroll).not.toBe(firstHandleScroll)
  })

  it('cancels a pending scroll persistence frame on unmount', () => {
    const { result, unmount } = renderHook(() => useScrollPosition('topics'))
    const container = document.createElement('div')
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      value: 128
    })
    result.current.containerRef.current = container

    result.current.handleScroll()

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

    unmount()

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(42)
    expect(cacheService.setCasual).not.toHaveBeenCalled()
  })
})
