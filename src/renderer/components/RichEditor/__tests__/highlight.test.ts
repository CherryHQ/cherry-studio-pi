import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MARKDOWN_SOURCE_LINE_ATTR } from '../constants'
import { clearRichEditorHighlight, createHighlightOverlay, findElementByLine, scrollAndHighlight } from '../highlight'

function createLine(line: number, text: string) {
  const element = document.createElement('p')
  element.setAttribute(MARKDOWN_SOURCE_LINE_ATTR, String(line))
  element.textContent = text
  return element
}

function mockRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = vi.fn(
    () =>
      ({
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        left: rect.left ?? 0,
        top: rect.top ?? 0,
        right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
        bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        toJSON: () => ({})
      }) as DOMRect
  )
}

describe('RichEditor highlight helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => window.setTimeout(callback, 0))
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((handle: number) => window.clearTimeout(handle))
    )
  })

  afterEach(() => {
    clearRichEditorHighlight()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('finds lines by content first, exact line second, and closest earlier line last', () => {
    const editorDom = document.createElement('div')
    const firstLine = createLine(4, 'first candidate')
    const secondLine = createLine(4, 'second candidate')
    const earlierLine = createLine(8, 'closest earlier line')
    editorDom.append(firstLine, secondLine, earlierLine)

    expect(findElementByLine(editorDom, 4, 'second')).toBe(secondLine)
    expect(findElementByLine(editorDom, 4)).toBe(firstLine)
    expect(findElementByLine(editorDom, 10)).toBe(earlierLine)
  })

  it('cancels pending scroll timers and frames before showing an overlay', () => {
    const element = createLine(1, 'target')
    const container = document.createElement('div')
    element.scrollIntoView = vi.fn()
    container.append(element)
    document.body.append(container)

    const cleanup = scrollAndHighlight(element, container)

    cleanup()
    vi.runAllTimers()

    expect(document.body.querySelector('.highlight-overlay')).toBeNull()
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(window.cancelAnimationFrame).not.toHaveBeenCalled()
  })

  it('removes stale overlay listeners when replacing the active highlight', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'rich-editor-wrapper'
    const firstContainer = document.createElement('div')
    const secondContainer = document.createElement('div')
    const firstElement = createLine(1, 'first')
    const secondElement = createLine(2, 'second')
    wrapper.append(firstContainer, secondContainer)
    firstContainer.append(firstElement)
    secondContainer.append(secondElement)
    document.body.append(wrapper)

    mockRect(firstContainer, { top: 0, bottom: 200, width: 200, height: 200 })
    mockRect(secondContainer, { top: 0, bottom: 200, width: 200, height: 200 })
    mockRect(firstElement, { left: 0, top: 20, width: 120, height: 24, bottom: 44 })
    mockRect(secondElement, { left: 0, top: 50, width: 160, height: 24, bottom: 74 })
    const firstRemoveListener = vi.spyOn(firstContainer, 'removeEventListener')

    const firstCleanup = createHighlightOverlay(firstElement, firstContainer)
    expect(document.body.querySelectorAll('.highlight-overlay')).toHaveLength(1)

    const secondCleanup = createHighlightOverlay(secondElement, secondContainer)

    expect(firstRemoveListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(document.body.querySelectorAll('.highlight-overlay')).toHaveLength(1)

    firstCleanup()
    expect(document.body.querySelectorAll('.highlight-overlay')).toHaveLength(1)

    secondCleanup()
    expect(document.body.querySelector('.highlight-overlay')).toBeNull()
  })
})
