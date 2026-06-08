import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storageClient: {
    execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
      void input
      return {
        rows: [],
        columns: [],
        columnTypes: []
      }
    })
  },
  withTransaction: vi.fn(async (_client: unknown, fn: () => Promise<unknown>) => fn()),
  recordChange: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/storage-v2-legacy-app-import-user-data')
  }
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: {
    resolveDataRoot: vi.fn(() => ({
      dataRoot: '/tmp/storage-v2-legacy-app-import-root'
    })),
    ensureDataRoot: vi.fn(() => ({
      dataRoot: '/tmp/storage-v2-legacy-app-import-root'
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

vi.mock('../SyncLogService', () => ({
  storageV2SyncLogService: {
    recordChange: mocks.recordChange
  }
}))

import { StorageV2LegacyAppDbImportService } from '../LegacyAppDbImportService'

type LegacyAppTable = 'app_records' | 'app_cache' | 'sync_state' | 'sync_conflicts' | 'workbench_shortcuts'

async function createLegacyDbWithTables(tables: LegacyAppTable[]) {
  const tmpDir = await fs.mkdtemp('/tmp/legacy-app-import-')
  const dbPath = path.join(tmpDir, 'app.db')
  const client = createClient({ url: `file:${dbPath}`, intMode: 'number' })

  if (tables.includes('app_records')) {
    await client.execute(`
      CREATE TABLE app_records (
        scope TEXT,
        key TEXT,
        value TEXT,
        updated_at INTEGER,
        deleted_at INTEGER,
        version INTEGER
      )
    `)
    await client.execute({
      sql: 'INSERT INTO app_records (scope, key, value, updated_at, version) VALUES (?, ?, ?, ?, ?)',
      args: ['settings', 'theme', JSON.stringify({ mode: 'dark' }), 1760000000000, 1]
    })
  }

  if (tables.includes('app_cache')) {
    await client.execute(`
      CREATE TABLE app_cache (
        namespace TEXT,
        key TEXT,
        value TEXT,
        updated_at INTEGER,
        expires_at INTEGER
      )
    `)
  }

  if (tables.includes('sync_state')) {
    await client.execute(`
      CREATE TABLE sync_state (
        id TEXT,
        value TEXT,
        updated_at INTEGER
      )
    `)
  }

  if (tables.includes('sync_conflicts')) {
    await client.execute(`
      CREATE TABLE sync_conflicts (
        id TEXT,
        scope TEXT,
        key TEXT,
        local_value TEXT,
        remote_value TEXT,
        local_hash TEXT,
        remote_hash TEXT,
        base_hash TEXT,
        created_at INTEGER,
        resolved_at INTEGER
      )
    `)
  }

  if (tables.includes('workbench_shortcuts')) {
    await client.execute(`
      CREATE TABLE workbench_shortcuts (
        id TEXT,
        name TEXT,
        url TEXT,
        source_path TEXT,
        kind TEXT,
        metadata TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      )
    `)
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

  return { tmpDir, dbPath }
}

describe('StorageV2LegacyAppDbImportService', () => {
  let tmpDirs: string[] = []

  beforeEach(() => {
    tmpDirs = []
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('does not prune Storage v2 app tables that are absent from the legacy app database', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['app_records'])
    tmpDirs.push(tmpDir)

    const report = await new StorageV2LegacyAppDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false
    })

    const executed = mocks.storageClient.execute.mock.calls.map((call) => {
      const input = call[0] as string | { sql: string; args?: unknown[] }
      return {
        sql: typeof input === 'string' ? input : input.sql,
        args: typeof input === 'string' ? [] : (input.args ?? [])
      }
    })
    const prunedSources = executed
      .filter((call) => call.sql.includes('UPDATE kv_records') && call.sql.includes('SET deleted_at'))
      .map((call) => call.args.find((arg) => typeof arg === 'string' && arg.startsWith('legacy-app-')))

    expect(report.sourceDbPath).toBe(dbPath)
    expect(report.recordCount).toBe(1)
    expect(report.importedRecordCount).toBe(1)
    expect(prunedSources).toEqual(['legacy-app-record'])
    expect(prunedSources).not.toContain('legacy-app-cache')
    expect(prunedSources).not.toContain('legacy-workbench-shortcut')
    expect(executed.some((call) => call.sql.includes('DELETE FROM sync_state'))).toBe(false)
    expect(executed.some((call) => call.sql.includes('DELETE FROM sync_conflicts'))).toBe(false)
  })

  it('can import legacy app data without pruning existing Storage v2 rows', async () => {
    const { tmpDir, dbPath } = await createLegacyDbWithTables(['app_records', 'sync_state', 'sync_conflicts'])
    tmpDirs.push(tmpDir)

    await new StorageV2LegacyAppDbImportService().importSnapshot({
      dryRun: false,
      dbPath,
      createSnapshot: false,
      pruneMissing: false
    })

    const executed = mocks.storageClient.execute.mock.calls.map((call) => {
      const input = call[0] as string | { sql: string; args?: unknown[] }
      return typeof input === 'string' ? input : input.sql
    })

    expect(executed.some((sql) => sql.includes('INSERT INTO kv_records'))).toBe(true)
    expect(executed.some((sql) => sql.includes('UPDATE kv_records') && sql.includes('SET deleted_at'))).toBe(false)
    expect(executed.some((sql) => sql.includes('DELETE FROM sync_state'))).toBe(false)
    expect(executed.some((sql) => sql.includes('DELETE FROM sync_conflicts'))).toBe(false)
  })
})
