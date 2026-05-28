import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: {
    execute: vi.fn(),
    close: vi.fn()
  },
  fs: {
    existsSync: vi.fn(),
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn()
  },
  app: {
    getPath: vi.fn()
  },
  utils: {
    getDataPath: vi.fn(),
    makeSureDirExists: vi.fn()
  }
}))

vi.mock('fs', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('electron', () => ({
  app: mocks.app
}))

vi.mock('@main/utils', () => mocks.utils)

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => mocks.client)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/knowledge/embedjs/embeddings/Embeddings', () => ({
  default: vi.fn()
}))

import { createClient } from '@libsql/client'

import MemoryService from '../MemoryService'

describe('MemoryService migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(17_000)
    mocks.app.getPath.mockImplementation((key: string) => {
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    })
    mocks.utils.getDataPath.mockImplementation((subPath?: string) => (subPath ? `/mock/data/${subPath}` : '/mock/data'))
    mocks.fs.existsSync.mockReturnValue(false)
    mocks.fs.renameSync.mockReturnValue(undefined)
    mocks.fs.copyFileSync.mockReturnValue(undefined)
    mocks.fs.unlinkSync.mockReturnValue(undefined)
    mocks.client.execute.mockResolvedValue({ rows: [], columns: [], columnTypes: [] })
    mocks.client.close.mockReturnValue(undefined)
  })

  it('migrates the legacy memory database and sidecars into the stable data root', () => {
    mocks.fs.existsSync.mockImplementation((candidate) =>
      ['/mock/userData/memories.db', '/mock/userData/memories.db-wal', '/mock/userData/memories.db-shm'].includes(
        String(candidate)
      )
    )

    MemoryService.getInstance().migrateMemoryDb()

    expect(mocks.fs.renameSync).toHaveBeenCalledWith('/mock/userData/memories.db', '/mock/data/Memory/memories.db')
    expect(mocks.fs.renameSync).toHaveBeenCalledWith(
      '/mock/userData/memories.db-wal',
      '/mock/data/Memory/memories.db-wal'
    )
    expect(mocks.fs.renameSync).toHaveBeenCalledWith(
      '/mock/userData/memories.db-shm',
      '/mock/data/Memory/memories.db-shm'
    )
  })

  it('archives the legacy memory database when the stable database already exists', () => {
    mocks.fs.existsSync.mockImplementation((candidate) =>
      ['/mock/userData/memories.db', '/mock/userData/memories.db-wal', '/mock/data/Memory/memories.db'].includes(
        String(candidate)
      )
    )

    MemoryService.getInstance().migrateMemoryDb()

    expect(mocks.fs.renameSync).toHaveBeenCalledWith(
      '/mock/userData/memories.db',
      '/mock/data/Memory/legacy/pre-storage-v2-memory-17000/memories.db'
    )
    expect(mocks.fs.renameSync).toHaveBeenCalledWith(
      '/mock/userData/memories.db-wal',
      '/mock/data/Memory/legacy/pre-storage-v2-memory-17000/memories.db-wal'
    )
    expect(mocks.fs.renameSync).not.toHaveBeenCalledWith('/mock/userData/memories.db', '/mock/data/Memory/memories.db')
  })

  it('falls back to copy and unlink when moving across devices', () => {
    mocks.fs.existsSync.mockImplementation((candidate) => String(candidate) === '/mock/userData/memories.db')
    mocks.fs.renameSync.mockImplementationOnce(() => {
      const error = new Error('Cross-device link')
      ;(error as NodeJS.ErrnoException).code = 'EXDEV'
      throw error
    })

    MemoryService.getInstance().migrateMemoryDb()

    expect(mocks.fs.copyFileSync).toHaveBeenCalledWith('/mock/userData/memories.db', '/mock/data/Memory/memories.db')
    expect(mocks.fs.unlinkSync).toHaveBeenCalledWith('/mock/userData/memories.db')
  })

  it('runs the legacy memory migration before opening the stable database', async () => {
    mocks.fs.existsSync.mockImplementation((candidate) => String(candidate) === '/mock/userData/memories.db')

    await (MemoryService.reload() as unknown as { init: () => Promise<void> }).init()

    expect(mocks.fs.renameSync).toHaveBeenCalledWith('/mock/userData/memories.db', '/mock/data/Memory/memories.db')
    expect(createClient).toHaveBeenCalledWith({
      url: 'file:/mock/data/Memory/memories.db',
      intMode: 'number'
    })
  })

  it('soft deletes all memories for a user and keeps delete history', async () => {
    mocks.client.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT id, memory FROM memories WHERE user_id')) {
        return {
          rows: [
            { id: 'memory-1', memory: 'First memory' },
            { id: 'memory-2', memory: 'Second memory' }
          ],
          columns: [],
          columnTypes: []
        }
      }
      return { rows: [], columns: [], columnTypes: [] }
    })

    await MemoryService.reload().deleteAllMemoriesForUser('user-1')

    const calls = mocks.client.execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(calls).toContain('BEGIN IMMEDIATE')
    expect(calls).toContain('COMMIT')
    expect(calls.some((sql) => sql.includes('DELETE FROM memories'))).toBe(false)
    expect(calls.some((sql) => sql.includes('DELETE FROM memory_history'))).toBe(false)
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE memories SET is_deleted = 1'),
        args: [expect.any(String), 'user-1']
      })
    )
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO memory_history'),
        args: ['memory-1', 'First memory', null, 'DELETE', expect.any(String), expect.any(String)]
      })
    )
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO memory_history'),
        args: ['memory-2', 'Second memory', null, 'DELETE', expect.any(String), expect.any(String)]
      })
    )
  })

  it('rolls back a single memory delete when delete history cannot be recorded', async () => {
    mocks.client.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT memory FROM memories WHERE id')) {
        return {
          rows: [{ memory: 'Important memory' }],
          columns: [],
          columnTypes: []
        }
      }
      if (sql.includes('INSERT INTO memory_history')) {
        throw new Error('history locked')
      }
      return { rows: [], columns: [], columnTypes: [] }
    })

    await expect(MemoryService.reload().delete('memory-1')).rejects.toThrow('history locked')

    const calls = mocks.client.execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(calls).toContain('BEGIN IMMEDIATE')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE memories SET is_deleted = 1'),
        args: [expect.any(String), 'memory-1']
      })
    )
  })

  it('rolls back a memory update when update history cannot be recorded', async () => {
    mocks.client.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT memory, metadata FROM memories WHERE id')) {
        return {
          rows: [{ memory: 'Old memory', metadata: '{"source":"old"}' }],
          columns: [],
          columnTypes: []
        }
      }
      if (sql.includes('INSERT INTO memory_history')) {
        throw new Error('history locked')
      }
      return { rows: [], columns: [], columnTypes: [] }
    })

    await expect(MemoryService.reload().update('memory-1', 'New memory', { source: 'new' })).rejects.toThrow(
      'history locked'
    )

    const calls = mocks.client.execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(calls).toContain('BEGIN IMMEDIATE')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE memories'),
        args: ['New memory', expect.any(String), null, '{"source":"new"}', expect.any(String), 'memory-1']
      })
    )
  })

  it('soft deletes non-default user memories instead of hard deleting rows', async () => {
    mocks.client.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT id, memory FROM memories WHERE user_id')) {
        return {
          rows: [{ id: 'memory-1', memory: 'User memory' }],
          columns: [],
          columnTypes: []
        }
      }
      return { rows: [], columns: [], columnTypes: [] }
    })

    await MemoryService.reload().deleteUser('user-2')

    const calls = mocks.client.execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(calls.some((sql) => sql.includes('DELETE FROM memories'))).toBe(false)
    expect(mocks.client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE memories SET is_deleted = 1'),
        args: [expect.any(String), 'user-2']
      })
    )
  })
})
