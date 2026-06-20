import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { _testing } from '../enhancedLink'

function createMouseEvent(type: string, target: EventTarget, relatedTarget?: EventTarget): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 12,
    clientY: 24
  })
  Object.defineProperty(event, 'target', { value: target, configurable: true })
  if (relatedTarget) {
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget, configurable: true })
  }
  return event
}

function createEditorViewStub() {
  return {
    posAtCoords: vi.fn(() => null),
    posAtDOM: vi.fn(() => -1),
    state: {
      doc: {
        content: {
          size: 0
        },
        resolve: vi.fn()
      }
    }
  }
}

describe('EnhancedLink hover plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('handles mouseover events from link text nodes', () => {
    const link = document.createElement('a')
    link.setAttribute('href', 'https://example.com')
    link.textContent = 'Example'
    document.body.append(link)

    const onLinkHover = vi.fn()
    const plugin = _testing.createLinkHoverPlugin({
      editable: true,
      hoverDelay: 0,
      onLinkHover
    })
    const handleMouseOver = plugin.props.handleDOMEvents?.mouseover

    expect(() =>
      handleMouseOver?.call(plugin, createEditorViewStub() as any, createMouseEvent('mouseover', link.firstChild!))
    ).not.toThrow()
    vi.runOnlyPendingTimers()

    expect(onLinkHover).toHaveBeenCalledTimes(1)
    expect(onLinkHover.mock.calls[0][0]).toEqual({
      href: 'https://example.com',
      text: 'Example',
      title: ''
    })
  })

  it('handles mouseout events whose related target is popup text', () => {
    const link = document.createElement('a')
    link.setAttribute('href', 'https://example.com')
    link.textContent = 'Example'

    const popup = document.createElement('div')
    popup.setAttribute('data-link-editor', '')
    popup.textContent = 'Edit link'

    document.body.append(link, popup)

    const onLinkHoverEnd = vi.fn()
    const plugin = _testing.createLinkHoverPlugin({
      editable: true,
      onLinkHoverEnd
    })
    const handleMouseOut = plugin.props.handleDOMEvents?.mouseout

    expect(() =>
      handleMouseOut?.call(
        plugin,
        createEditorViewStub() as any,
        createMouseEvent('mouseout', link.firstChild!, popup.firstChild!)
      )
    ).not.toThrow()

    expect(onLinkHoverEnd).not.toHaveBeenCalled()
  })
})
