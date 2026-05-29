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
})
