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
})
