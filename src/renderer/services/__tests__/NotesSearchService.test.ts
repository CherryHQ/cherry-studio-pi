import type { NotesTreeNode } from '@renderer/types/note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { flattenTreeToFiles, matchFileName, searchAllFiles, searchFileContent } from '../NotesSearchService'

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
  const readExternalMock = vi.fn()

  beforeEach(() => {
    readExternalMock.mockReset()
    Object.defineProperty(window, 'api', {
      value: {
        file: {
          readExternal: readExternalMock
        }
      },
      configurable: true
    })
  })

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

  it('does not treat blank keywords as filename matches', () => {
    expect(matchFileName(makeNode('note.md', 'file'), '   ')).toBe(false)
  })

  it('does not scan files for blank full-text searches', async () => {
    const result = await searchAllFiles([makeNode('note.md', 'file')], '   ')

    expect(result).toEqual([])
    expect(readExternalMock).not.toHaveBeenCalled()
  })

  it('skips zero-length regex matches instead of looping forever', async () => {
    readExternalMock.mockResolvedValue('alpha\nbeta')

    const result = await searchFileContent(makeNode('note.md', 'file'), '^', { useRegex: true })

    expect(result).toBeNull()
  })
})
