import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesRoot: '',
  reduxSelect: vi.fn(),
  scanDir: vi.fn(),
  getName: vi.fn()
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: mocks.reduxSelect
  }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn()
  }
}))

vi.mock('@main/utils/file', () => ({
  getName: mocks.getName,
  getNotesDir: () => mocks.notesRoot,
  scanDir: mocks.scanDir,
  isPathInside: (childPath: string, parentPath: string) => {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
}))

import { createNotesCapabilities } from '../providers/notes'

const getCapability = (id: string) => {
  const capability = createNotesCapabilities().find((item) => item.id === id)
  if (!capability) throw new Error(`Missing capability ${id}`)
  return capability
}

describe('notes app capabilities', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = `/tmp/cherry-notes-capability-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await fs.mkdir(tmpDir, { recursive: true })
    mocks.notesRoot = tmpDir
    mocks.reduxSelect.mockReset()
    mocks.reduxSelect.mockResolvedValue({ notesPath: tmpDir })
    mocks.scanDir.mockReset()
    mocks.getName.mockReset()
    mocks.getName.mockReturnValue('Untitled')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('lists notes through a bounded lightweight scanner instead of returning the full tree', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      await fs.writeFile(path.join(tmpDir, `${name}.md`), `${name}\n`, 'utf8')
    }

    const result = await getCapability('notes.list').execute({ limit: 2 }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).notes).toEqual([
      expect.objectContaining({ type: 'file', name: 'alpha', treePath: '/alpha' }),
      expect.objectContaining({ type: 'file', name: 'beta', treePath: '/beta' })
    ])
    expect((result.data as any).truncated).toBe(true)
    expect((result.data as any).nextOffset).toBe(2)
    expect(mocks.scanDir).not.toHaveBeenCalled()
  })

  it('supports notes.list offset pagination', async () => {
    for (const name of ['alpha', 'beta', 'gamma', 'omega']) {
      await fs.writeFile(path.join(tmpDir, `${name}.md`), `${name}\n`, 'utf8')
    }

    const result = await getCapability('notes.list').execute({ limit: 2, offset: 2 }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).notes).toEqual([
      expect.objectContaining({ name: 'gamma' }),
      expect.objectContaining({ name: 'omega' })
    ])
    expect((result.data as any).truncated).toBe(false)
    expect((result.data as any).nextOffset).toBeNull()
  })

  it('treats notes.search limit as a result limit instead of a file scan limit', async () => {
    const nodes: any[] = []
    for (let index = 0; index < 20; index += 1) {
      const filePath = path.join(tmpDir, `miss-${index}.md`)
      await fs.writeFile(filePath, 'ordinary note\n', 'utf8')
      nodes.push({
        type: 'file',
        name: `miss-${index}`,
        treePath: `/miss-${index}`,
        externalPath: filePath
      })
    }

    const targetPath = path.join(tmpDir, 'target.md')
    await fs.writeFile(targetPath, 'needle appears late\n', 'utf8')
    nodes.push({
      type: 'file',
      name: 'target',
      treePath: '/target',
      externalPath: targetPath
    })
    mocks.scanDir.mockResolvedValue(nodes)

    const result = await getCapability('notes.search').execute({ query: 'needle', limit: 1 }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).matches).toEqual([
      expect.objectContaining({
        name: 'target',
        snippet: expect.stringContaining('needle')
      })
    ])
    expect((result.data as any).scannedFiles).toBe(21)
  })

  it('skips oversized note files during notes.search', async () => {
    const largePath = path.join(tmpDir, 'large.md')
    await fs.writeFile(largePath, `${'x'.repeat(512 * 1024 + 1)}needle`, 'utf8')
    mocks.scanDir.mockResolvedValue([
      {
        type: 'file',
        name: 'large',
        treePath: '/large',
        externalPath: largePath
      }
    ])

    const result = await getCapability('notes.search').execute({ query: 'needle' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).matches).toEqual([])
  })

  it('returns filename matches without reading oversized note content', async () => {
    const largePath = path.join(tmpDir, 'needle-large.md')
    await fs.writeFile(largePath, 'x'.repeat(512 * 1024 + 1), 'utf8')
    mocks.scanDir.mockResolvedValue([
      {
        type: 'file',
        name: 'needle-large',
        treePath: '/needle-large',
        externalPath: largePath
      }
    ])
    const readFileSpy = vi.spyOn(fs, 'readFile')

    const result = await getCapability('notes.search').execute({ query: 'needle' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).matches).toEqual([
      expect.objectContaining({
        name: 'needle-large',
        match: 'name',
        snippet: ''
      })
    ])
    expect(readFileSpy).not.toHaveBeenCalled()
    readFileSpy.mockRestore()
  })

  it('returns a bounded preview when reading oversized notes', async () => {
    const notePath = path.join(tmpDir, 'large-note.md')
    await fs.writeFile(notePath, 'a'.repeat(2048), 'utf8')

    const result = await getCapability('notes.read').execute(
      {
        path: 'large-note',
        maxBytes: 128
      },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect((result.data as any).content).toHaveLength(128)
    expect((result.data as any).truncated).toBe(true)
    expect((result.data as any).byteSize).toBe(2048)
    expect((result.data as any).maxBytes).toBe(128)
  })
})
