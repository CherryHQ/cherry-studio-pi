import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesRoot: '',
  reduxSelect: vi.fn(),
  preferenceService: {
    get: vi.fn()
  },
  scanDir: vi.fn(),
  getName: vi.fn(),
  notifyDataSyncLocalChange: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return mocks.preferenceService
      throw new Error(`Unknown service: ${name}`)
    })
  }
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

vi.mock('@main/services/appData/DataSyncLocalChangeNotifier', () => ({
  notifyMainProcessDataSyncLocalChange: mocks.notifyDataSyncLocalChange
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
    mocks.preferenceService.get.mockReset()
    mocks.preferenceService.get.mockImplementation((key: string) => {
      if (key === 'feature.notes.path') return tmpDir
      return undefined
    })
    mocks.scanDir.mockReset()
    mocks.getName.mockReset()
    mocks.getName.mockReturnValue('Untitled')
    mocks.notifyDataSyncLocalChange.mockReset()
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

  it('rejects invalid numeric option shapes before scanning or reading notes', async () => {
    await fs.writeFile(path.join(tmpDir, 'daily.md'), 'today\n', 'utf8')

    await expect(getCapability('notes.list').execute({ limit: true }, { source: 'agent' })).rejects.toThrow(
      'Note list limit must be a number'
    )
    await expect(getCapability('notes.list').execute({ offset: { page: 1 } }, { source: 'agent' })).rejects.toThrow(
      'Note list offset must be a number'
    )
    await expect(
      getCapability('notes.search').execute({ query: 'today', limit: ['10'] }, { source: 'agent' })
    ).rejects.toThrow('Note search limit must be a number')
    await expect(
      getCapability('notes.read').execute({ path: 'daily', maxBytes: true }, { source: 'agent' })
    ).rejects.toThrow('Note read maxBytes must be a number')
  })

  it('treats notes.search limit as a result limit instead of a file scan limit', async () => {
    for (let index = 0; index < 20; index += 1) {
      const filePath = path.join(tmpDir, `miss-${index}.md`)
      await fs.writeFile(filePath, 'ordinary note\n', 'utf8')
    }

    const targetPath = path.join(tmpDir, 'target.md')
    await fs.writeFile(targetPath, 'needle appears late\n', 'utf8')

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

    const result = await getCapability('notes.search').execute({ query: 'needle' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).matches).toEqual([])
  })

  it('returns filename matches without reading oversized note content', async () => {
    const largePath = path.join(tmpDir, 'needle-large.md')
    await fs.writeFile(largePath, 'x'.repeat(512 * 1024 + 1), 'utf8')
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

  it('normalizes note read paths before resolving them', async () => {
    const notePath = path.join(tmpDir, 'daily.md')
    await fs.writeFile(notePath, 'today\n', 'utf8')

    const result = await getCapability('notes.read').execute({ path: ' daily ' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).path).toBe(notePath)
    expect((result.data as any).content).toBe('today\n')
  })

  it('rejects note symlinks that resolve outside the notes root', async () => {
    const outsideDir = `${tmpDir}-outside`
    const outsideFile = path.join(outsideDir, 'secret.md')
    const escapeFile = path.join(tmpDir, 'escape.md')
    const escapeDir = path.join(tmpDir, 'linked-outside')
    await fs.mkdir(outsideDir, { recursive: true })
    try {
      await fs.writeFile(outsideFile, 'outside\n', 'utf8')
      await fs.symlink(outsideFile, escapeFile)
      await fs.symlink(outsideDir, escapeDir, 'dir')

      await expect(getCapability('notes.read').execute({ path: 'escape' }, { source: 'agent' })).rejects.toThrow(
        'Note path resolves outside the notes root directory'
      )
      await expect(
        getCapability('notes.write').execute({ path: 'escape', content: 'overwrite' }, { source: 'agent' })
      ).rejects.toThrow('Note path resolves outside the notes root directory')
      await expect(
        getCapability('notes.create').execute({ parent: 'linked-outside', name: 'created' }, { source: 'agent' })
      ).rejects.toThrow('Note parent resolves outside the notes root directory')
      expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside\n')
      await expect(fs.stat(path.join(outsideDir, 'created.md'))).rejects.toThrow()
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('normalizes note create and write inputs before touching the filesystem', async () => {
    mocks.getName.mockImplementation((_parent: string, name: string) => name)

    const created = await getCapability('notes.create').execute(
      {
        parent: ' folder ',
        name: ' Daily ',
        content: { title: 'Morning', done: false }
      },
      { source: 'agent' }
    )

    const filePath = path.join(tmpDir, 'folder', 'Daily.md')
    expect(created.data).toEqual({ path: filePath, name: 'Daily' })
    expect(await fs.readFile(filePath, 'utf8')).toBe('{\n  "title": "Morning",\n  "done": false\n}')
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'app-capability.notes.create',
      path: filePath
    })

    const written = await getCapability('notes.write').execute(
      {
        path: ' folder/Daily ',
        content: 123
      },
      { source: 'agent' }
    )

    expect(written.data).toEqual({ path: filePath })
    expect(await fs.readFile(filePath, 'utf8')).toBe('123')
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenLastCalledWith('file', {
      source: 'app-capability.notes.write',
      path: filePath
    })
  })

  it('creates missing parent directories when writing nested notes', async () => {
    const filePath = path.join(tmpDir, 'projects', 'alpha', 'plan.md')

    const result = await getCapability('notes.write').execute(
      {
        path: 'projects/alpha/plan',
        content: 'ship it\n'
      },
      { source: 'agent' }
    )

    expect(result.data).toEqual({ path: filePath })
    expect(await fs.readFile(filePath, 'utf8')).toBe('ship it\n')
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'app-capability.notes.write',
      path: filePath
    })
  })

  it('rejects missing note write content without truncating the existing note', async () => {
    const notePath = path.join(tmpDir, 'daily.md')
    await fs.writeFile(notePath, 'keep me\n', 'utf8')
    const writeFileSpy = vi.spyOn(fs, 'writeFile')

    try {
      await expect(getCapability('notes.write').execute({ path: 'daily' }, { source: 'agent' })).rejects.toThrow(
        'Note content is required'
      )

      expect(writeFileSpy).not.toHaveBeenCalled()
      expect(await fs.readFile(notePath, 'utf8')).toBe('keep me\n')
      expect(mocks.notifyDataSyncLocalChange).not.toHaveBeenCalled()
    } finally {
      writeFileSpy.mockRestore()
    }
  })

  it('allows explicit empty note content when overwriting notes', async () => {
    const notePath = path.join(tmpDir, 'daily.md')
    await fs.writeFile(notePath, 'clear me\n', 'utf8')

    const result = await getCapability('notes.write').execute({ path: 'daily', content: '' }, { source: 'agent' })

    expect(result.data).toEqual({ path: notePath })
    expect(await fs.readFile(notePath, 'utf8')).toBe('')
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'app-capability.notes.write',
      path: notePath
    })
  })

  it('notifies data sync after deleting a note', async () => {
    const notePath = path.join(tmpDir, 'daily.md')
    await fs.writeFile(notePath, 'today\n', 'utf8')

    const result = await getCapability('notes.delete').execute({ path: 'daily' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'app-capability.notes.delete',
      path: notePath
    })
  })

  it('rejects empty note paths with clear errors', async () => {
    await expect(getCapability('notes.read').execute({ path: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Note path is required'
    )
    await expect(
      getCapability('notes.write').execute({ path: '   ', content: 'content' }, { source: 'agent' })
    ).rejects.toThrow('Note path is required')
    await expect(getCapability('notes.delete').execute({ path: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Note path is required'
    )
  })

  it('does not allow deleting the notes root directory', async () => {
    const rmSpy = vi.spyOn(fs, 'rm')

    await expect(getCapability('notes.delete').execute({ path: ' . ' }, { source: 'agent' })).rejects.toThrow(
      'Cannot delete the notes root directory'
    )
    expect(rmSpy).not.toHaveBeenCalled()

    rmSpy.mockRestore()
  })
})
