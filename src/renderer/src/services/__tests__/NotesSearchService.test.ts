import type { NotesTreeNode } from '@renderer/types/note'
import { describe, expect, it } from 'vitest'

import { flattenTreeToFiles } from '../NotesSearchService'

const makeNode = (id: string, type: NotesTreeNode['type'], children?: NotesTreeNode[]): NotesTreeNode => ({
  id,
  name: id,
  type,
  treePath: id,
  externalPath: id,
  children,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('NotesSearchService', () => {
  it('flattens file nodes in the same pre-order as the note tree', () => {
    const tree = [
      makeNode('root-file', 'file'),
      makeNode('folder-a', 'folder', [
        makeNode('a-file-1', 'file'),
        makeNode('folder-b', 'folder', [makeNode('b-file-1', 'file')]),
        makeNode('a-file-2', 'file')
      ]),
      makeNode('hint', 'hint'),
      makeNode('tail-file', 'file')
    ]

    expect(flattenTreeToFiles(tree).map((node) => node.id)).toEqual([
      'root-file',
      'a-file-1',
      'b-file-1',
      'a-file-2',
      'tail-file'
    ])
  })

  it('handles deeply nested folders without recursive traversal', () => {
    let current = makeNode('leaf-file', 'file')

    for (let index = 0; index < 12_000; index += 1) {
      current = makeNode(`folder-${index}`, 'folder', [current])
    }

    expect(flattenTreeToFiles([current]).map((node) => node.id)).toEqual(['leaf-file'])
  })
})
