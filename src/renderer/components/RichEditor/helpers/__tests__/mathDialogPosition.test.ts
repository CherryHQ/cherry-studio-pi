import { describe, expect, it, vi } from 'vitest'

import { getMathDialogPosition } from '../mathDialogPosition'

function mockRect(element: Element, rect: Partial<DOMRect>) {
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

function editorReturning(dom: Node | null) {
  return {
    view: {
      nodeDOM: vi.fn(() => dom)
    }
  }
}

describe('getMathDialogPosition', () => {
  it('uses the rendered math wrapper returned by nodeDOM', () => {
    const math = document.createElement('span')
    math.dataset.type = 'inline-math'
    mockRect(math, { left: 10, top: 20, width: 80, height: 24, bottom: 44 })

    expect(getMathDialogPosition(editorReturning(math), 7)).toEqual({ x: 50, y: 44, top: 20 })
  })

  it('walks from a child text node to the nearest math wrapper', () => {
    const wrapper = document.createElement('div')
    wrapper.dataset.type = 'block-math'
    const child = document.createElement('span')
    const text = document.createTextNode('x+y')
    child.append(text)
    wrapper.append(child)
    mockRect(wrapper, { left: 4, top: 8, width: 40, height: 12, bottom: 20 })

    expect(getMathDialogPosition(editorReturning(text), 3)).toEqual({ x: 24, y: 20, top: 8 })
  })

  it('returns undefined when the editor cannot resolve a DOM node', () => {
    expect(getMathDialogPosition(editorReturning(null), 1)).toBeUndefined()
    expect(getMathDialogPosition(null, 1)).toBeUndefined()
  })
})
