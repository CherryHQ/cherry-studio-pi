import { act, renderHook } from '@testing-library/react'
import type { DragEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useDrag } from '../useDrag'

function createDragEvent(currentTarget: HTMLElement, relatedTarget: EventTarget | null = null) {
  return {
    currentTarget,
    relatedTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as DragEvent<HTMLElement>
}

describe('useDrag', () => {
  it('keeps dragging active when drag leaves into a child element', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    parent.appendChild(child)

    const { result } = renderHook(() => useDrag<HTMLElement>())

    act(() => {
      result.current.handleDragEnter(createDragEvent(parent))
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.handleDragLeave(createDragEvent(parent, child))
    })

    expect(result.current.isDragging).toBe(true)
  })

  it('clears dragging when drag leaves the window with no related target', () => {
    const parent = document.createElement('div')
    const { result } = renderHook(() => useDrag<HTMLElement>())

    act(() => {
      result.current.handleDragEnter(createDragEvent(parent))
    })
    expect(result.current.isDragging).toBe(true)

    expect(() => {
      act(() => {
        result.current.handleDragLeave(createDragEvent(parent, null))
      })
    }).not.toThrow()

    expect(result.current.isDragging).toBe(false)
  })

  it('clears dragging when drag leaves to a non-node related target', () => {
    const parent = document.createElement('div')
    const { result } = renderHook(() => useDrag<HTMLElement>())

    act(() => {
      result.current.handleDragEnter(createDragEvent(parent))
    })
    expect(result.current.isDragging).toBe(true)

    expect(() => {
      act(() => {
        result.current.handleDragLeave(createDragEvent(parent, window))
      })
    }).not.toThrow()

    expect(result.current.isDragging).toBe(false)
  })
})
