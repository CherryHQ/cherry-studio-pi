import { afterEach, describe, expect, it, vi } from 'vitest'

import { findElementNextToCoords } from '../findNextElementFromCursor'

const originalElementsFromPoint = document.elementsFromPoint

function mockElementsFromPoint(elements: Element[]) {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: vi.fn(() => elements)
  })
}

function createEditorStub(posAtDOM = vi.fn(() => 1), nodeAt = vi.fn(() => ({ isText: false }))) {
  return {
    view: {
      posAtDOM
    },
    state: {
      doc: {
        nodeAt
      }
    }
  }
}

describe('findElementNextToCoords', () => {
  afterEach(() => {
    if (originalElementsFromPoint) {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint
      })
    }
    vi.restoreAllMocks()
  })

  it('does not ask ProseMirror for positions when the editor is not under the pointer', () => {
    const outside = document.createElement('div')
    const posAtDOM = vi.fn(() => 1)
    const editor = createEditorStub(posAtDOM)
    mockElementsFromPoint([outside, document.body])

    const result = findElementNextToCoords({
      editor: editor as any,
      x: 1,
      y: 10,
      direction: 'left'
    })

    expect(posAtDOM).not.toHaveBeenCalled()
    expect(result).toEqual({
      resultElement: null,
      resultNode: null,
      pos: null
    })
  })

  it('uses the element above the ProseMirror root as the candidate block', () => {
    const block = document.createElement('p')
    const editorRoot = document.createElement('div')
    editorRoot.className = 'ProseMirror'
    const node = { isText: false }
    const posAtDOM = vi.fn(() => 5)
    const nodeAt = vi.fn(() => node)
    const editor = createEditorStub(posAtDOM, nodeAt)
    mockElementsFromPoint([block, editorRoot, document.body])

    const result = findElementNextToCoords({
      editor: editor as any,
      x: 1,
      y: 10,
      direction: 'left'
    })

    expect(posAtDOM).toHaveBeenCalledWith(block, 0)
    expect(result).toEqual({
      resultElement: block,
      resultNode: node,
      pos: 5
    })
  })
})
