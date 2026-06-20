import { describe, expect, it } from 'vitest'

import { removeDraggableFromDragHandleTarget } from '../dragHandleTarget'

describe('removeDraggableFromDragHandleTarget', () => {
  it('ignores non-element targets', () => {
    expect(removeDraggableFromDragHandleTarget(document.createTextNode('drag'))).toBe(false)
    expect(removeDraggableFromDragHandleTarget(window)).toBe(false)
  })

  it('removes draggable from drag handle elements', () => {
    const handle = document.createElement('div')
    handle.className = 'drag-handle'
    handle.setAttribute('draggable', 'true')

    expect(removeDraggableFromDragHandleTarget(handle)).toBe(true)
    expect(handle.hasAttribute('draggable')).toBe(false)
  })

  it('leaves other elements unchanged', () => {
    const element = document.createElement('div')
    element.setAttribute('draggable', 'true')

    expect(removeDraggableFromDragHandleTarget(element)).toBe(false)
    expect(element.getAttribute('draggable')).toBe('true')
  })
})
