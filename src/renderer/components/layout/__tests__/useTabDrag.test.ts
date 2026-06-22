// @vitest-environment jsdom
import type { Tab } from '@renderer/hooks/useTabs'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useTabDrag } from '../useTabDrag'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn()
    })
  }
}))

const tab: Tab = {
  id: 'tab-1',
  type: 'route',
  url: '/home',
  title: 'Tab 1',
  lastAccessTime: 1,
  isDormant: false
}

function renderUseTabDrag() {
  return renderHook(() =>
    useTabDrag({
      pinnedTabs: [],
      normalTabs: [tab],
      canDetach: false,
      reorderTabs: vi.fn(),
      closeTab: vi.fn(),
      setActiveTab: vi.fn()
    })
  )
}

function createPointerDownEvent(currentTarget: HTMLButtonElement, target: EventTarget | null): React.PointerEvent {
  return {
    button: 0,
    clientX: 40,
    clientY: 20,
    currentTarget,
    pointerId: 7,
    screenX: 140,
    screenY: 120,
    target
  } as unknown as React.PointerEvent
}

describe('useTabDrag', () => {
  it('does not start dragging when pointerdown originates from a text node inside a close button', () => {
    const { result } = renderUseTabDrag()
    const tabButton = document.createElement('button')
    const closeButton = document.createElement('div')
    const setPointerCapture = vi.fn()

    tabButton.setPointerCapture = setPointerCapture
    closeButton.setAttribute('role', 'button')
    closeButton.appendChild(document.createTextNode('close'))

    act(() => {
      result.current.handlePointerDown(createPointerDownEvent(tabButton, closeButton.firstChild), tab, 'normal')
    })

    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it('ignores non-element event targets without crashing', () => {
    const { result } = renderUseTabDrag()
    const tabButton = document.createElement('button')
    const setPointerCapture = vi.fn()

    tabButton.setPointerCapture = setPointerCapture

    act(() => {
      result.current.handlePointerDown(createPointerDownEvent(tabButton, window), tab, 'normal')
    })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
  })
})
