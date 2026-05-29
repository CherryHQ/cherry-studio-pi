import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storageClient: {
    execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('SELECT id, version') && sql.includes('FROM agents') && sql.includes('deleted_at IS NULL')) {
        return {
          rows: [{ id: 'stale-agent', version: 2 }],
          columns: [],
          columnTypes: []
        }
      }

      return {
        rows: [],
        columns: [],
        columnTypes: []
      }
    })
  },
  withTransaction: vi.fn(async (_client: unknown, fn: () => Promise<unknown>) => fn()),
  recordChange: vi.fn(),
  importConversation: vi.fn(),
  deleteConversation: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/storage-v2-legacy-agent-import-user-data')
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: {
    resolveDataRoot: vi.fn(() => ({
      dataRoot: '/tmp/storage-v2-legacy-agent-import-root'
    })),
    ensureDataRoot: vi.fn(() => ({
      dataRoot: '/tmp/storage-v2-legacy-agent-import-root'
    }))
  }
}))

vi.mock('../SecretVaultService', () => ({
  storageV2SecretVaultService: {
    isAvailable: vi.fn(() => false),
    setSecret: vi.fn()
  }
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: {
    getClient: vi.fn(async () => mocks.storageClient),
    withTransaction: mocks.withTransaction,
    createSnapshot: vi.fn()
  }
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2ConversationRepository: {
    importConversation: mocks.importConversation,
    delete: mocks.deleteConversation
  }
}))

vi.mock('../SyncLogService', () => ({
  storageV2SyncLogService: {
    recordChange: mocks.recordChange
  }
}))

import { StorageV2LegacyAgentDbImportService } from '../LegacyAgentDbImportService'

async function createLegacyDbWithTables(tables: Array<'agents' | 'sessions' | 'session_messages'>) {
  const tmpDir = await fs.mkdtemp('/tmp/legacy-agent-import-')
  const dbPath = path.join(tmpDir, 'agents.db')
  const client = createClient({ url: `file:${dbPath}`, intMode: 'number' })

  if (tables.includes('agents')) {
    await client.execute(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        type TEXT,
        name TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      )
    `)
    await client.execute({
      sql: "INSERT INTO agents (id, type, name, created_at, updated_at) VALUES (?, 'pi', ?, ?, ?)",
      args: ['agent-1', 'Agent One', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    })
  }

  if (tables.includes('sessions')) {
    await client.execute(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        name TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)
    await client.execute({
      sql: 'INSERT INTO sessions (id, agent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: ['session-1', 'agent-1', 'Session One', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    })
  }

  if (tables.includes('session_messages')) {
    await client.execute(`
      CREATE TABLE session_messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)
    await client.execute({
      sql: 'INSERT INTO session_messages (id, session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [1, 'session-1', 'user', 'hello', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    })
  }

  client.close()

  const verifyClient = createClient({ url: `file:${dbPath}`, intMode: 'number' })
  const expectedTables = await verifyClient.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
  for (const table of tables) {
    if (!expectedTables.rows.some((row) => row.name === table)) {
      throw new Error(`Failed to create legacy table ${table}`)
    }
  }
  verifyClient.close()
  vi.mocked(fsSync.existsSync).mockImplementation((candidate) => String(candidate) === dbPath)

  return { tmpDir, dbPath }
}

describe('StorageV2LegacyAgentDbImportService', () => {
  let tmpDirs: string[] = []

  beforeEach(() => {
    tmpDirs = []
    vi.clearAllMocks()
    vi.mocked(fsSync.existsSync).mockReturnValue(false)
  })

  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('does not prune Storage v2 tables that are absent from the legacy agent database', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['agents'])
    tmpDirs.push(tmpDir)

    const report = await new StorageV2LegacyAgentDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false
    })

    const executedSql = mocks.storageClient.execute.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input.sql
    )

    expect(report.dryRun).toBe(false)
    expect(report.sourceDbPath).toBe(dbPath)
    expect(report.agentCount).toBe(1)
    expect(report.importedAgentCount).toBe(1)
    expect(executedSql.some((sql) => sql.includes('UPDATE agents'))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('UPDATE agent_sessions'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('UPDATE scheduled_tasks'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('UPDATE channels'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM agent_skills'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM task_run_logs'))).toBe(false)
    expect(mocks.importConversation).not.toHaveBeenCalled()
    expect(mocks.deleteConversation).not.toHaveBeenCalled()
  })

  it('does not mirror empty session histories when the legacy messages table is absent', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['agents', 'sessions'])
    tmpDirs.push(tmpDir)

    await new StorageV2LegacyAgentDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false
    })

    expect(mocks.importConversation).not.toHaveBeenCalled()
  })

  it('mirrors session conversations only when legacy session messages are available', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['agents', 'sessions', 'session_messages'])
    tmpDirs.push(tmpDir)

    await new StorageV2LegacyAgentDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false
    })

    expect(mocks.importConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-session:session-1',
        sessionId: 'session-1',
        messages: [expect.objectContaining({ id: 'agent-message:1' })]
      }),
      {
        pruneMissingBlocks: true,
        pruneMissingMessages: true
      }
    )
  })

  it('can import legacy agent data without pruning existing Storage v2 rows', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['agents', 'sessions', 'session_messages'])
    tmpDirs.push(tmpDir)

    await new StorageV2LegacyAgentDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false,
      pruneMissing: false
    })

    const executedSql = mocks.storageClient.execute.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input.sql
    )

    expect(executedSql.some((sql) => sql.includes('INSERT INTO agents'))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('SET deleted_at'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM agent_skills'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM task_run_logs'))).toBe(false)
    expect(mocks.deleteConversation).not.toHaveBeenCalled()
    expect(mocks.importConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-session:session-1'
      }),
      {
        pruneMissingBlocks: false,
        pruneMissingMessages: false
      }
    )
  })
})
