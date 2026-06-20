import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  preferenceGet: vi.fn(),
  notifyMainProcessDataSyncLocalChange: vi.fn(),
  readRendererStoreValue: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.applicationGet
  }
}))

vi.mock('@main/services/appData/DataSyncLocalChangeNotifier', () => ({
  notifyMainProcessDataSyncLocalChange: mocks.notifyMainProcessDataSyncLocalChange
}))

vi.mock('../../rendererBridge', () => ({
  readRendererStoreValue: mocks.readRendererStoreValue
}))

import { createNotesCapabilities } from '../notes'

function capability(id: string) {
  const item = createNotesCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('notes app capabilities', () => {
  let notesRoot = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    notesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-capability-'))
    mocks.preferenceGet.mockReturnValue(notesRoot)
    mocks.applicationGet.mockReturnValue({ get: mocks.preferenceGet })
  })

  afterEach(async () => {
    if (notesRoot) await fs.rm(notesRoot, { force: true, recursive: true })
  })

  it('rejects invalid note search queries before resolving the notes root', async () => {
    await expect(capability('notes.search').execute({ query: ['hello'] }, { source: 'agent' })).rejects.toThrow(
      'Note search query must be a string'
    )

    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.readRendererStoreValue).not.toHaveBeenCalled()
  })

  it('rejects invalid note paths and names before filesystem mutations', async () => {
    await expect(capability('notes.read').execute({ path: 123 }, { source: 'agent' })).rejects.toThrow(
      'Note path must be a string'
    )
    await expect(
      capability('notes.create').execute({ parent: { path: 'projects' }, name: 'One' }, { source: 'agent' })
    ).rejects.toThrow('Note parent must be a string')
    await expect(
      capability('notes.create').execute({ parent: 'projects', name: ['One'] }, { source: 'agent' })
    ).rejects.toThrow('Note name must be a string')
    await expect(
      capability('notes.write').execute({ path: false, content: 'hello' }, { source: 'agent' })
    ).rejects.toThrow('Note path must be a string')
    await expect(capability('notes.delete').execute({ path: [] }, { source: 'agent' })).rejects.toThrow(
      'Note path must be a string'
    )

    expect(await fs.readdir(notesRoot)).toEqual([])
    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.notifyMainProcessDataSyncLocalChange).not.toHaveBeenCalled()
  })

  it('rejects non-object notes capability inputs before resolving the notes root', async () => {
    await expect(capability('notes.list').execute('list' as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )
    await expect(capability('notes.read').execute(['read'] as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )
    await expect(capability('notes.search').execute(false as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )
    await expect(capability('notes.create').execute('create' as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )
    await expect(capability('notes.write').execute(['write'] as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )
    await expect(capability('notes.delete').execute(true as any, { source: 'agent' })).rejects.toThrow(
      'Notes capability input must be an object'
    )

    expect(await fs.readdir(notesRoot)).toEqual([])
    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.readRendererStoreValue).not.toHaveBeenCalled()
    expect(mocks.notifyMainProcessDataSyncLocalChange).not.toHaveBeenCalled()
  })

  it('stops notes capabilities before filesystem work when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped notes work')
    const context = { source: 'agent' as const, signal: controller.signal }

    await expect(capability('notes.list').execute({}, context)).rejects.toThrow('agent stopped notes work')
    await expect(capability('notes.read').execute({ path: 'one' }, context)).rejects.toThrow('agent stopped notes work')
    await expect(capability('notes.search').execute({ query: 'hello' }, context)).rejects.toThrow(
      'agent stopped notes work'
    )
    await expect(capability('notes.create').execute({ name: 'one', content: 'hello' }, context)).rejects.toThrow(
      'agent stopped notes work'
    )
    await expect(capability('notes.write').execute({ path: 'one', content: 'hello' }, context)).rejects.toThrow(
      'agent stopped notes work'
    )
    await expect(capability('notes.delete').execute({ path: 'one' }, context)).rejects.toThrow(
      'agent stopped notes work'
    )

    expect(await fs.readdir(notesRoot)).toEqual([])
    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.readRendererStoreValue).not.toHaveBeenCalled()
    expect(mocks.notifyMainProcessDataSyncLocalChange).not.toHaveBeenCalled()
  })

  it('notifies data sync for completed note writes before surfacing caller cancellation', async () => {
    const controller = new AbortController()
    mocks.notifyMainProcessDataSyncLocalChange.mockImplementationOnce(() => {
      controller.abort('agent cancelled after note write')
    })

    await expect(
      capability('notes.write').execute(
        { path: 'daily/today', content: 'hello from agent' },
        { source: 'agent', signal: controller.signal }
      )
    ).rejects.toThrow('agent cancelled after note write')

    const filePath = path.join(notesRoot, 'daily', 'today.md')
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('hello from agent')
    expect(mocks.notifyMainProcessDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'app-capability.notes.write',
      path: filePath
    })
  })
})
