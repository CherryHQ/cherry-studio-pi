import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HorizontalScrollContainer from '../HorizontalScrollContainer'

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

function getScrollContent(container: HTMLElement) {
  const content = container.querySelector('[data-scrolling]')
  if (!(content instanceof HTMLElement)) {
    throw new Error('HorizontalScrollContainer content was not rendered')
  }
  return content
}

describe('HorizontalScrollContainer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('expands when clicking a text-node target inside the container', () => {
    const { container } = render(
      <HorizontalScrollContainer expandable>
        <span>plain text</span>
      </HorizontalScrollContainer>
    )
    const content = getScrollContent(container)
    const textNode = screen.getByText('plain text').firstChild

    expect(content.style.whiteSpace).toBe('nowrap')
    expect(textNode).toBeInstanceOf(Node)

    fireEvent.click(textNode as Node)

    expect(content.style.whiteSpace).toBe('normal')
  })

  it('does not expand when clicking text inside a no-expand target', () => {
    const { container } = render(
      <HorizontalScrollContainer expandable>
        <button data-no-expand>close</button>
      </HorizontalScrollContainer>
    )
    const content = getScrollContent(container)
    const textNode = screen.getByText('close').firstChild

    expect(content.style.whiteSpace).toBe('nowrap')
    expect(textNode).toBeInstanceOf(Node)

    fireEvent.click(textNode as Node)

    expect(content.style.whiteSpace).toBe('nowrap')
  })
})
