import { describe, expect, it, vi } from 'vitest'

import { PlusButtonPlugin } from '../plusButtonPlugin'

function createMouseLeaveEvent(relatedTarget: EventTarget | null): MouseEvent {
  const event = new MouseEvent('mouseleave', {
    bubbles: true,
    cancelable: true
  })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget, configurable: true })
  return event
}

describe('PlusButtonPlugin', () => {
  it('handles mouseleave related targets that are not DOM nodes', () => {
    const editor = { isEditable: true }
    const element = document.createElement('button')
    const onNodeChange = vi.fn()
    const { plugin } = PlusButtonPlugin({
      editor: editor as any,
      element,
      onNodeChange
    })
    const handleMouseLeave = plugin.props.handleDOMEvents?.mouseleave

    expect(() => handleMouseLeave?.call(plugin, {} as any, createMouseLeaveEvent(window))).not.toThrow()

    expect(onNodeChange).toHaveBeenCalledWith({ editor, node: null, pos: -1 })
  })

  it('keeps the button visible when mouseleave moves into the button wrapper', () => {
    const editor = { isEditable: true }
    const element = document.createElement('button')
    element.textContent = 'Add'
    const onNodeChange = vi.fn()
    const { plugin } = PlusButtonPlugin({
      editor: editor as any,
      element,
      onNodeChange
    })
    const handleMouseLeave = plugin.props.handleDOMEvents?.mouseleave

    expect(() => handleMouseLeave?.call(plugin, {} as any, createMouseLeaveEvent(element.firstChild))).not.toThrow()

    expect(onNodeChange).not.toHaveBeenCalled()
  })
})
