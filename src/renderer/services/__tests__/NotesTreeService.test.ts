import type { NotesTreeNode } from '@renderer/types/note'
import { describe, expect, it } from 'vitest'

import { findNodeByPath, removePathEntries, replacePathEntries } from '../NotesTreeService'

const makeNode = (overrides: Partial<NotesTreeNode>): NotesTreeNode => ({
  id: 'node',
  name: 'node',
  type: 'file',
  treePath: 'folder/note.md',
  externalPath: 'C:/Users/test/Notes/folder/note.md',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('NotesTreeService', () => {
  describe('findNodeByPath', () => {
    it('matches tree paths and external paths with Windows separators', () => {
      const child = makeNode({
        id: 'child',
        treePath: 'folder/note.md',
        externalPath: 'C:/Users/test/Notes/folder/note.md'
      })
      const tree = [
        makeNode({
          id: 'root',
          type: 'folder',
          treePath: 'folder',
          externalPath: 'C:/Users/test/Notes/folder',
          children: [child]
        })
      ]

      expect(findNodeByPath(tree, 'folder\\note.md')).toBe(child)
      expect(findNodeByPath(tree, 'C:\\Users\\test\\Notes\\folder\\note.md')).toBe(child)
    })
  })

  describe('removePathEntries', () => {
    it('removes descendants without matching sibling path prefixes', () => {
      const paths = ['C:\\notes\\a', 'C:\\notes\\a\\child.md', 'C:\\notes\\a-b\\child.md']

      expect(removePathEntries(paths, 'C:/notes/a', true)).toEqual(['C:\\notes\\a-b\\child.md'])
    })
  })

  describe('replacePathEntries', () => {
    it('renames descendants without touching sibling path prefixes', () => {
      const paths = ['C:\\notes\\a', 'C:\\notes\\a\\child.md', 'C:\\notes\\a-b\\child.md']

      expect(replacePathEntries(paths, 'C:/notes/a', 'C:/notes/z', true)).toEqual([
        'C:/notes/z',
        'C:/notes/z/child.md',
        'C:\\notes\\a-b\\child.md'
      ])
    })
  })
})
