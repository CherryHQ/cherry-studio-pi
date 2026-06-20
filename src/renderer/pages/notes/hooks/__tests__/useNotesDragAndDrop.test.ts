import type { NotesTreeNode } from '@renderer/types/note'
import { act, renderHook } from '@testing-library/react'
import type { DragEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNotesDragAndDrop } from '../useNotesDragAndDrop'

function makeNode(overrides: Partial<NotesTreeNode> = {}): NotesTreeNode {
  return {
    id: 'note-1',
    name: 'note',
    type: 'file',
    treePath: 'note.md',
    externalPath: '/notes/note.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeDragEvent(currentTarget: HTMLDivElement): DragEvent<HTMLDivElement> {
  return {
    currentTarget,
    dataTransfer: {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(),
      setDragImage: vi.fn()
    }
  } as unknown as DragEvent<HTMLDivElement>
}

describe('useNotesDragAndDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('cleans up the drag ghost safely if it has already been detached', () => {
    const onMoveNode = vi.fn()
    const { result } = renderHook(() => useNotesDragAndDrop({ onMoveNode }))
    const parent = document.createElement('div')
    const row = document.createElement('div')
    parent.appendChild(row)
    document.body.appendChild(parent)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      width: 240,
      height: 32,
      top: 0,
      left: 0,
      right: 240,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    const event = makeDragEvent(row)

    act(() => {
      result.current.handleDragStart(event, makeNode())
    })

    expect(result.current.draggedNodeId).toBe('note-1')
    expect(event.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'note-1')
    expect(event.dataTransfer.setDragImage).toHaveBeenCalled()

    const ghostElement = vi.mocked(event.dataTransfer.setDragImage).mock.calls[0][0] as HTMLElement
    expect(document.body.contains(ghostElement)).toBe(true)

    ghostElement.remove()

    expect(() => {
      act(() => {
        vi.runOnlyPendingTimers()
      })
    }).not.toThrow()
    expect(document.body.contains(ghostElement)).toBe(false)
  })
})
