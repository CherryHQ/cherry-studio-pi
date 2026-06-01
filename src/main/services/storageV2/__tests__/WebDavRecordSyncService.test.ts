import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dbClient: {
    execute: vi.fn()
  },
  webdav: {
    exists: vi.fn(),
    createDirectory: vi.fn(),
    getFileContents: vi.fn(),
    putFileContents: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: {
    getClient: vi.fn(async () => mocks.dbClient)
  }
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: {
    ensureDataRoot: vi.fn(() => ({ dataRoot: '/tmp/cherry-studio-pi-test-data' }))
  }
}))

import { storageV2Database } from '../StorageV2Database'
import { StorageV2WebDavRecordSyncService } from '../WebDavRecordSyncService'

const settingsTable = {
  entityType: 'settings',
  table: 'settings',
  idColumns: ['key'],
  updatedAtColumn: 'updated_at',
  deletedAtColumn: 'deleted_at',
  versionColumn: 'version'
} as const

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key])
      return result
    }, {})
}

function hashJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

type SettingsRow = {
  key: string
  value_json: string
  scope: string
  updated_at: string
  deleted_at: string | null
  version: number
}

function makeSettingsDb(rows: SettingsRow[]) {
  const state = {
    rows: [...rows],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (sql.includes('SELECT * FROM settings')) {
          return { rows: state.rows.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(settings)')) {
          return {
            rows: [
              { name: 'key' },
              { name: 'value_json' },
              { name: 'scope' },
              { name: 'updated_at' },
              { name: 'deleted_at' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO settings')) {
          const nextRow: SettingsRow = {
            key: String(args[0]),
            value_json: String(args[1]),
            scope: String(args[2]),
            updated_at: String(args[3]),
            deleted_at: args[4] == null ? null : String(args[4]),
            version: Number(args[5])
          }
          const index = state.rows.findIndex((row) => row.key === nextRow.key)
          if (index === -1) {
            state.rows.push(nextRow)
          } else {
            state.rows[index] = nextRow
          }
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeSharedWebDavStore() {
  const files = new Map<string, unknown>()
  return {
    files,
    client: {
      exists: vi.fn(async () => true),
      createDirectory: vi.fn(async () => undefined),
      getFileContents: vi.fn(async (filePath: string) => {
        if (!files.has(filePath)) {
          throw new Error(`Missing remote file: ${filePath}`)
        }
        return files.get(filePath)
      }),
      putFileContents: vi.fn(async (filePath: string, contents: unknown) => {
        files.set(filePath, contents)
        return true
      })
    }
  }
}

describe('StorageV2WebDavRecordSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.webdav.exists.mockResolvedValue(true)
    mocks.webdav.createDirectory.mockResolvedValue(undefined)
    mocks.webdav.putFileContents.mockResolvedValue(undefined)
    mocks.webdav.getFileContents.mockResolvedValue('')
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('SELECT value_json FROM sync_state')) {
        return { rows: [] }
      }

      if (sql.includes('INSERT INTO sync_state')) {
        return { rows: [] }
      }

      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }

      if (sql.includes('INSERT INTO settings')) {
        return { rows: [] }
      }

      return { rows: [] }
    })
  })

  it('uploads local Storage v2 rows as WebDAV records', async () => {
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return {
          rows: [
            {
              key: 'theme',
              value_json: '{"mode":"dark"}',
              scope: 'app',
              updated_at: '2026-05-29T12:00:00.000Z',
              deleted_at: null,
              version: 1
            }
          ]
        }
      }
      if (sql.includes('SELECT value_json FROM sync_state') || sql.includes('INSERT INTO sync_state')) {
        return { rows: [] }
      }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      null
    )

    expect(result.summary.storageUploaded).toBe(1)
    expect(result.manifest.records['settings:theme']).toEqual(
      expect.objectContaining({
        entityType: 'settings',
        table: 'settings',
        idValues: ['theme']
      })
    )
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/storage-v2/records/settings/'),
      expect.stringContaining('"key": "theme"'),
      { overwrite: true }
    )
  })

  it('downloads remote Storage v2 rows into the local database', async () => {
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    mocks.webdav.getFileContents.mockResolvedValue(JSON.stringify(remoteRecord))

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      }
    )

    const insertCall = mocks.dbClient.execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO settings')
    })

    expect(result.summary.storageDownloaded).toBe(1)
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: ['theme', '{"mode":"light"}', 'app', '2026-05-29T12:10:00.000Z', null, 2]
      })
    )
  })

  it('prefers remote Storage v2 rows when a device has no prior sync baseline', async () => {
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"local-default"}',
      scope: 'app',
      updated_at: '2026-05-29T12:20:00.000Z',
      deleted_at: null,
      version: 3
    }
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"remote-user"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    mocks.webdav.getFileContents.mockResolvedValue(JSON.stringify(remoteRecord))
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return { rows: [localRow] }
      }
      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      }
    )

    const insertCall = mocks.dbClient.execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO settings')
    })

    expect(result.summary.storageDownloaded).toBe(1)
    expect(result.summary.storageUploaded).toBe(0)
    expect(result.summary.storageConflicts).toBe(0)
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: ['theme', '{"mode":"remote-user"}', 'app', '2026-05-29T12:10:00.000Z', null, 2]
      })
    )
    expect(
      mocks.webdav.putFileContents.mock.calls.some(
        ([filePath, contents]) =>
          String(filePath).includes('/storage-v2/records/settings/') && String(contents).includes('local-default')
      )
    ).toBe(false)
  })

  it('simulates two devices syncing through the same WebDAV store', async () => {
    const remote = makeSharedWebDavStore()
    const deviceA = makeSettingsDb([
      {
        key: 'theme',
        value_json: '{"mode":"device-a-user-value"}',
        scope: 'app',
        updated_at: '2026-05-29T12:00:00.000Z',
        deleted_at: null,
        version: 1
      }
    ])
    const deviceB = makeSettingsDb([
      {
        key: 'theme',
        value_json: '{"mode":"device-b-default"}',
        scope: 'app',
        updated_at: '2026-05-29T12:20:00.000Z',
        deleted_at: null,
        version: 3
      }
    ])
    const getClient = vi.mocked(storageV2Database.getClient)
    const service = new StorageV2WebDavRecordSyncService([settingsTable])

    getClient.mockResolvedValueOnce(deviceA.client as any)
    const firstSync = await service.sync(remote.client as any, '/remote-root/sync/v1', null)
    const remoteHashAfterDeviceA = firstSync.manifest.records['settings:theme']?.valueHash

    getClient.mockResolvedValueOnce(deviceB.client as any)
    const secondSync = await service.sync(remote.client as any, '/remote-root/sync/v1', firstSync.manifest)

    expect(firstSync.summary.storageUploaded).toBe(1)
    expect(secondSync.summary.storageDownloaded).toBe(1)
    expect(secondSync.summary.storageUploaded).toBe(0)
    expect(secondSync.summary.storageConflicts).toBe(0)
    expect(deviceB.state.rows[0]).toMatchObject({
      value_json: '{"mode":"device-a-user-value"}',
      updated_at: '2026-05-29T12:00:00.000Z',
      version: 1
    })
    expect(secondSync.manifest.records['settings:theme']?.valueHash).toBe(remoteHashAfterDeviceA)
    expect(
      Array.from(remote.files.entries()).some(
        ([filePath, contents]) =>
          filePath.includes('/storage-v2/records/settings/') && String(contents).includes('device-b-default')
      )
    ).toBe(false)
  })
})
