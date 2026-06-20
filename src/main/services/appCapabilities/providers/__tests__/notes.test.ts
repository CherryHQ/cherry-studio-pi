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
      '笔记搜索关键词 必须是字符串'
    )

    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.readRendererStoreValue).not.toHaveBeenCalled()
  })

  it('rejects invalid note paths and names before filesystem mutations', async () => {
    await expect(capability('notes.read').execute({ path: 123 }, { source: 'agent' })).rejects.toThrow(
      '笔记路径 必须是字符串'
    )
    await expect(
      capability('notes.create').execute({ parent: { path: 'projects' }, name: 'One' }, { source: 'agent' })
    ).rejects.toThrow('笔记父目录 必须是字符串')
    await expect(
      capability('notes.create').execute({ parent: 'projects', name: ['One'] }, { source: 'agent' })
    ).rejects.toThrow('笔记名称 必须是字符串')
    await expect(
      capability('notes.write').execute({ path: false, content: 'hello' }, { source: 'agent' })
    ).rejects.toThrow('笔记路径 必须是字符串')
    await expect(capability('notes.delete').execute({ path: [] }, { source: 'agent' })).rejects.toThrow(
      '笔记路径 必须是字符串'
    )

    expect(await fs.readdir(notesRoot)).toEqual([])
    expect(mocks.applicationGet).not.toHaveBeenCalled()
    expect(mocks.notifyMainProcessDataSyncLocalChange).not.toHaveBeenCalled()
  })

  it('rejects non-object notes capability inputs before resolving the notes root', async () => {
    await expect(capability('notes.list').execute('list' as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
    )
    await expect(capability('notes.read').execute(['read'] as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
    )
    await expect(capability('notes.search').execute(false as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
    )
    await expect(capability('notes.create').execute('create' as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
    )
    await expect(capability('notes.write').execute(['write'] as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
    )
    await expect(capability('notes.delete').execute(true as any, { source: 'agent' })).rejects.toThrow(
      '笔记能力的输入必须是对象'
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

  it('passes caller signals into note read and write file operations', async () => {
    const filePath = path.join(notesRoot, 'daily.md')
    await fs.writeFile(filePath, 'hello from disk', 'utf8')
    const controller = new AbortController()
    const context = { source: 'agent' as const, signal: controller.signal }
    const readSpy = vi.spyOn(fs, 'readFile')
    const writeSpy = vi.spyOn(fs, 'writeFile')

    try {
      await capability('notes.read').execute({ path: 'daily' }, context)
      await capability('notes.write').execute({ path: 'daily', content: 'hello from agent' }, context)

      expect(readSpy).toHaveBeenCalledWith(
        filePath,
        expect.objectContaining({ encoding: 'utf8', signal: controller.signal })
      )
      expect(writeSpy).toHaveBeenCalledWith(
        filePath,
        'hello from agent',
        expect.objectContaining({ encoding: 'utf8', signal: controller.signal })
      )
    } finally {
      readSpy.mockRestore()
      writeSpy.mockRestore()
    }
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
