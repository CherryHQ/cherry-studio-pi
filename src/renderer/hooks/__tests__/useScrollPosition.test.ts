import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
})
