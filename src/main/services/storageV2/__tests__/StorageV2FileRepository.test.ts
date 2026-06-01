import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: {
    execute: vi.fn()
  },
  database: {
    getClient: vi.fn(),
    withTransaction: vi.fn(async (_client: unknown, fn: () => Promise<void>) => fn())
  },
  dataRoot: {
    ensureDataRoot: vi.fn()
  },
  syncLog: {
    recordChange: vi.fn()
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs')
  return {
    ...actual,
    default: actual
  }
})

vi.mock('../StorageV2Database', () => ({
  storageV2Database: mocks.database
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: mocks.dataRoot
}))

vi.mock('../SyncLogService', () => ({
  storageV2SyncLogService: mocks.syncLog
}))

describe('StorageV2FileRepository', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.database.getClient.mockResolvedValue(mocks.client)
    mocks.database.withTransaction.mockImplementation(async (_client: unknown, fn: () => Promise<void>) => fn())
    mocks.syncLog.recordChange.mockResolvedValue(undefined)
  })

  it('normalizes blob MIME values to legacy file types', async () => {
    mocks.client.execute.mockResolvedValue({
      rows: [
        {
          id: 'file-1',
          original_name: 'notes.txt',
          display_name: null,
          metadata_json: '{}',
          created_at: '2026-01-01T00:00:00.000Z',
          blob_ext: '.txt',
          blob_mime: 'text/plain',
          blob_size: 42
        }
      ]
    })

    const { StorageV2FileRepository } = await import('../StorageV2Repositories')
    const files = await new StorageV2FileRepository().list()

    expect(files[0]).toEqual(
      expect.objectContaining({
        id: 'file-1',
        type: 'text',
        ext: '.txt',
        size: 42
      })
    )
  })

  it('refreshes the old and new blob ref counts when a file points at a new blob', async () => {
    const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'storage-v2-file-repoint-'))
    const sourcePath = path.join(tempDir, 'source.txt')
    fs.writeFileSync(sourcePath, 'new blob content')
    const checksum = createHash('sha256').update('new blob content').digest('hex')

    mocks.dataRoot.ensureDataRoot.mockReturnValue({ dataRoot: tempDir })
    mocks.client.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT blob_id FROM files WHERE id = ?')) {
        return { rows: [{ blob_id: 'old-blob' }], columns: [], columnTypes: [] }
      }
      if (sql.includes('SELECT version FROM files')) {
        return { rows: [{ version: 7 }], columns: [], columnTypes: [] }
      }
      return { rows: [], columns: [], columnTypes: [] }
    })

    try {
      const { StorageV2FileRepository } = await import('../StorageV2Repositories')

      await expect(
        new StorageV2FileRepository().importFile({
          id: 'file-1',
          path: sourcePath,
          name: 'source.txt',
          origin_name: 'source.txt',
          ext: '.txt',
          type: 'text'
        })
      ).resolves.toEqual({ imported: true })

      const blobRefCountArgs = mocks.client.execute.mock.calls
        .filter(
          ([input]) =>
            typeof input !== 'string' && input.sql.includes('UPDATE blobs') && input.sql.includes('ref_count')
        )
        .map(([input]) => (typeof input === 'string' ? [] : input.args))

      expect(blobRefCountArgs).toEqual(
        expect.arrayContaining([
          [checksum, checksum],
          ['old-blob', 'old-blob']
        ])
      )
      expect(mocks.syncLog.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'file',
          entityId: 'file-1',
          version: 7
        })
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('imports blob bytes from a staging path without persisting the staging path in metadata', async () => {
    const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'storage-v2-file-stage-'))
    const stagingPath = path.join(tempDir, 'staged.txt')
    const legacyPath = path.join(tempDir, 'Files', 'file-1.txt')
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(stagingPath, 'staged blob content')

    mocks.dataRoot.ensureDataRoot.mockReturnValue({ dataRoot: tempDir })
    mocks.client.execute.mockResolvedValue({ rows: [], columns: [], columnTypes: [] })

    try {
      const { StorageV2FileRepository } = await import('../StorageV2Repositories')

      await expect(
        new StorageV2FileRepository().importFile({
          id: 'file-1',
          path: legacyPath,
          storageV2SourcePath: stagingPath,
          name: 'file-1.txt',
          origin_name: 'source.txt',
          ext: '.txt',
          type: 'text'
        })
      ).resolves.toEqual({ imported: true })

      const fileUpsertCall = mocks.client.execute.mock.calls.find(
        ([input]) => typeof input !== 'string' && input.sql.includes('INSERT INTO files')
      )
      const metadataJson = typeof fileUpsertCall?.[0] === 'string' ? undefined : fileUpsertCall?.[0].args?.[4]
      const metadata = JSON.parse(String(metadataJson))

      expect(metadata.path).toBe(legacyPath)
      expect(metadata.storageV2SourcePath).toBeUndefined()
      expect(fs.existsSync(stagingPath)).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
