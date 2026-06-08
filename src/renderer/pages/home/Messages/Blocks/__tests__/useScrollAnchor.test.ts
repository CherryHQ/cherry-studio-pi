import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useScrollAnchor } from '../useScrollAnchor'

function defineReadonlyNumber(element: HTMLElement, key: 'clientHeight' | 'scrollHeight', value: number) {
  Object.defineProperty(element, key, {
    configurable: true,
    value
  })
}

function setupAnchor() {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  defineReadonlyNumber(scroller, 'clientHeight', 100)
  defineReadonlyNumber(scroller, 'scrollHeight', 500)
  scroller.scrollTop = 200

  const anchor = document.createElement('div')
  scroller.append(anchor)
  document.body.append(scroller)

  return { anchor, scroller }
}

describe('useScrollAnchor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('restores the scroll position after the anchor drifts', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback)
        return callbacks.length
      })
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { anchor, scroller } = setupAnchor()
    anchor.getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce({ top: 100 } as DOMRect)
      .mockReturnValueOnce({ top: 125 } as DOMRect)

    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>())
    result.current.anchorRef.current = anchor

    act(() => {
      result.current.withScrollAnchor(() => undefined)
    })

    expect(scroller.scrollTop).toBe(200)

    act(() => {
      callbacks[0](0)
    })

    expect(scroller.scrollTop).toBe(225)
  })

  it('cancels stale restore frames before scheduling another and on unmount', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { anchor } = setupAnchor()
    anchor.getBoundingClientRect = vi.fn(() => ({ top: 100 }) as DOMRect)

    const { result, unmount } = renderHook(() => useScrollAnchor<HTMLDivElement>())
    result.current.anchorRef.current = anchor

    act(() => {
      result.current.withScrollAnchor(() => undefined)
      result.current.withScrollAnchor(() => undefined)
    })

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1)

    unmount()

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(2)
  })
})
