import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { Client, InValue } from '@libsql/client'
import { loggerService } from '@logger'
import { writeWebDavJsonAtomically } from '@main/services/WebDavAtomic'
import { runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import type { WebDAVClient } from 'webdav'

import { storageV2DataRootService } from './DataRootService'
import { storageV2Database } from './StorageV2Database'

const logger = loggerService.withContext('StorageV2WebDavRecordSyncService')
const LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000

type StorageV2SyncTable = {
  entityType: string
  table: string
  idColumns: readonly string[]
  updatedAtColumn?: string
  deletedAtColumn?: string
  versionColumn?: string
  blobStoragePathColumn?: string
  blobChecksumColumn?: string
}

type LocalRecord = {
  id: string
  table: StorageV2SyncTable
  idValues: string[]
  row: Record<string, InValue>
  valueHash: string
  updatedAt: number
  deletedAt: number | null
  version: number
}

type RemoteRecordMeta = {
  entityType: string
  table: string
  idValues: string[]
  valueHash: string
  updatedAt: number
  deletedAt?: number | null
  version: number
  path: string
}

type RemoteBlobMeta = {
  id: string
  checksum: string
  byteSize: number
  storagePath: string
  path: string
  updatedAt: number
}

type RemoteRecordBundleMeta = {
  version: 1
  path: string
  valueHash: string
  recordCount: number
  blobCount: number
  updatedAt: number
}

type StorageV2WebDavRecordSyncBundle = {
  version: 1
  updatedAt: number
  records: Record<string, LocalRecord>
  blobs: Record<string, RemoteBlobMeta>
}

export type StorageV2WebDavRecordSyncManifest = {
  version: 1
  records: Record<string, RemoteRecordMeta>
  blobs: Record<string, RemoteBlobMeta>
  bundle?: RemoteRecordBundleMeta | null
}

export type StorageV2WebDavRecordSyncSummary = {
  storageUploaded: number
  storageDownloaded: number
  storageDeleted: number
  storageConflicts: number
  storageResolvedConflicts: number
  storageSkipped: number
  blobUploaded: number
  blobDownloaded: number
}

const EMPTY_SUMMARY: StorageV2WebDavRecordSyncSummary = {
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageResolvedConflicts: 0,
  storageSkipped: 0,
  blobUploaded: 0,
  blobDownloaded: 0
}

const TOMBSTONE_ENTITY_TYPE = 'sync_tombstone'
const STORAGE_V2_LEGACY_RECORD_BUNDLE_PATH = 'storage-v2/bundle/current.json'
const STORAGE_V2_BUNDLE_DIR = 'storage-v2/bundle'
const TOMBSTONE_PHYSICAL_DELETE_TARGETS = {
  agent_skill: {
    table: 'agent_skills',
    idColumns: ['agent_id', 'skill_id']
  },
  channel_task_subscription: {
    table: 'channel_task_subscriptions',
    idColumns: ['channel_id', 'task_id']
  }
} as const

const STORAGE_V2_SYNC_TABLES: readonly StorageV2SyncTable[] = [
  { entityType: 'profile', table: 'profiles', idColumns: ['id'], updatedAtColumn: 'updated_at' },
  {
    entityType: 'provider',
    table: 'providers',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'model',
    table: 'models',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at'
  },
  {
    entityType: 'blob',
    table: 'blobs',
    idColumns: ['id'],
    updatedAtColumn: 'created_at',
    blobStoragePathColumn: 'storage_path',
    blobChecksumColumn: 'checksum'
  },
  {
    entityType: 'assistant',
    table: 'assistants',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  { entityType: 'assistant_version', table: 'assistant_versions', idColumns: ['id'], updatedAtColumn: 'created_at' },
  {
    entityType: 'agent',
    table: 'agents',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  { entityType: 'agent_version', table: 'agent_versions', idColumns: ['id'], updatedAtColumn: 'created_at' },
  {
    entityType: 'skill',
    table: 'skills',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'agent_skill',
    table: 'agent_skills',
    idColumns: ['agent_id', 'skill_id'],
    updatedAtColumn: 'updated_at'
  },
  {
    entityType: 'agent_session',
    table: 'agent_sessions',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'scheduled_task',
    table: 'scheduled_tasks',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'channel',
    table: 'channels',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'channel_task_subscription',
    table: 'channel_task_subscriptions',
    idColumns: ['channel_id', 'task_id'],
    updatedAtColumn: 'updated_at'
  },
  {
    entityType: 'conversation',
    table: 'conversations',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'message',
    table: 'messages',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'message_block',
    table: 'message_blocks',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'file',
    table: 'files',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'knowledge_base',
    table: 'knowledge_bases',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'knowledge_item',
    table: 'knowledge_items',
    idColumns: ['id'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'task_run_log',
    table: 'task_run_logs',
    idColumns: ['id'],
    updatedAtColumn: 'run_at',
    versionColumn: 'version'
  },
  {
    entityType: 'kv_record',
    table: 'kv_records',
    idColumns: ['scope', 'key'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: 'settings',
    table: 'settings',
    idColumns: ['key'],
    updatedAtColumn: 'updated_at',
    deletedAtColumn: 'deleted_at',
    versionColumn: 'version'
  },
  {
    entityType: TOMBSTONE_ENTITY_TYPE,
    table: 'sync_tombstones',
    idColumns: ['entity_type', 'entity_id'],
    updatedAtColumn: 'deleted_at',
    versionColumn: 'version'
  }
] as const

function makeManifest(): StorageV2WebDavRecordSyncManifest {
  return { version: 1, records: {}, blobs: {}, bundle: null }
}

function normalizeManifest(manifest?: StorageV2WebDavRecordSyncManifest | null): StorageV2WebDavRecordSyncManifest {
  return {
    version: 1,
    records: manifest?.records ?? {},
    blobs: manifest?.blobs ?? {},
    bundle: manifest?.bundle ?? null
  }
}

function encodePart(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function safeRemoteRelativePath(value: string) {
  const normalized = path.posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error('Remote Storage v2 record path is invalid')
  }
  return normalized
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

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

function bundleHash(bundle: Pick<StorageV2WebDavRecordSyncBundle, 'records' | 'blobs'>) {
  return hashJson({
    records: bundle.records,
    blobs: bundle.blobs
  })
}

function recordId(entityType: string, idValues: readonly string[]) {
  return `${entityType}:${idValues.map((value) => encodePart(value)).join(':')}`
}

function recordPath(record: Pick<LocalRecord, 'id' | 'table'>) {
  return `storage-v2/records/${encodePart(record.table.entityType)}/${hashJson(record.id)}.json`
}

function recordBundlePath(valueHash?: string) {
  return valueHash ? `${STORAGE_V2_BUNDLE_DIR}/${encodePart(valueHash)}.json` : STORAGE_V2_LEGACY_RECORD_BUNDLE_PATH
}

function isBundleRecordPath(value: string) {
  const normalized = normalizePathForManifestEntry(value)
  return (
    normalized === STORAGE_V2_LEGACY_RECORD_BUNDLE_PATH ||
    (normalized.startsWith(`${STORAGE_V2_BUNDLE_DIR}/`) && normalized.endsWith('.json'))
  )
}

function blobPath(blobId: string, checksum?: string) {
  return checksum
    ? `storage-v2/blobs/${encodePart(blobId)}-${encodePart(checksum)}`
    : `storage-v2/blobs/${encodePart(blobId)}`
}

function recordMetaFromLocalRecord(record: LocalRecord, relativePath = recordPath(record)): RemoteRecordMeta {
  return {
    entityType: record.table.entityType,
    table: record.table.table,
    idValues: record.idValues,
    valueHash: record.valueHash,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    version: record.version,
    path: relativePath
  }
}

function parseTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && value.length >= 10) return numeric

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizePathForManifestEntry(value: string | undefined | null) {
  if (!value) {
    return ''
  }

  return safeRemoteRelativePath(value)
}

function tableWeight(tables: readonly StorageV2SyncTable[], entityType: string) {
  const index = tables.findIndex((table) => table.entityType === entityType)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function toSqlValue(value: unknown): InValue {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return String(value)
}

function rowToPlain(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, InValue>>((result, [key, value]) => {
    result[key] = toSqlValue(value)
    return result
  }, {})
}

function tombstoneTargetFromRecord(entityType: string, idValues: readonly string[]) {
  if (!Object.hasOwn(TOMBSTONE_PHYSICAL_DELETE_TARGETS, entityType)) return null

  const target = TOMBSTONE_PHYSICAL_DELETE_TARGETS[entityType as keyof typeof TOMBSTONE_PHYSICAL_DELETE_TARGETS]
  if (idValues.length !== target.idColumns.length || idValues.some((value) => !value)) return null

  return {
    entityType,
    entityId: idValues.join(':'),
    idValues
  }
}

function tombstoneTargetFromRow(row: Record<string, unknown>) {
  const entityType = typeof row.entity_type === 'string' ? row.entity_type : null
  const entityId = typeof row.entity_id === 'string' ? row.entity_id : null
  if (!entityType || !entityId || !Object.hasOwn(TOMBSTONE_PHYSICAL_DELETE_TARGETS, entityType)) return null

  const target = TOMBSTONE_PHYSICAL_DELETE_TARGETS[entityType as keyof typeof TOMBSTONE_PHYSICAL_DELETE_TARGETS]
  const idValues = entityId.split(':')
  if (idValues.length !== target.idColumns.length || idValues.some((value) => !value)) return null

  return {
    entityType,
    idValues
  }
}

function bufferToString(value: string | Buffer | ArrayBuffer | unknown) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  return String(value)
}

function bufferFromRemoteContents(value: string | Buffer | ArrayBuffer | unknown) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'string') return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return Buffer.from(String(value))
}

function normalizeLocalStoragePath(input: string) {
  const normalized = path.normalize(input)
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('Storage v2 blob path is invalid')
  }
  return normalized
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  return hash.digest('hex')
}

function isIgnorableCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && (error.status === 405 || error.status === 409)
}

export class StorageV2WebDavRecordSyncService {
  private columnsByTable = new Map<string, string[]>()
  private skillIdRemaps = new Map<string, string>()

  constructor(private readonly tables: readonly StorageV2SyncTable[] = STORAGE_V2_SYNC_TABLES) {}

  private tableByEntity(entityType: string) {
    return this.tables.find((table) => table.entityType === entityType) ?? null
  }

  private async ensureDirectory(client: WebDAVClient, dirPath: string) {
    if (dirPath === '/') return

    try {
      if (await runWebDavOperation(`checking remote directory ${dirPath}`, () => client.exists(dirPath), { logger })) {
        return
      }
    } catch (error) {
      if (!(error instanceof WebDavOperationError) || error.status !== 403) {
        throw error
      }
      logger.warn(`Cannot check remote directory ${dirPath}; trying to create it directly`, error)
    }

    try {
      await runWebDavOperation(
        `creating remote directory ${dirPath}`,
        () => client.createDirectory(dirPath, { recursive: true }),
        {
          logger
        }
      )
    } catch (error) {
      if (isIgnorableCreateDirectoryError(error)) {
        logger.warn(`Remote directory ${dirPath} already exists or was created concurrently`, error as Error)
        return
      }
      throw error
    }
  }

  private async assertWriteAccess(client: WebDAVClient, basePath: string) {
    const probePath = path.posix.join(basePath, `.cherry-studio-pi-storage-write-test-${Date.now()}.tmp`)
    await runWebDavOperation(
      `writing Storage v2 sync probe ${probePath}`,
      () => client.putFileContents(probePath, 'ok', { overwrite: true }),
      { logger }
    )

    const maybeDeleteFile = (client as WebDAVClient & { deleteFile?: (filePath: string) => Promise<void> }).deleteFile
    if (typeof maybeDeleteFile !== 'function') {
      return
    }

    await runWebDavOperation(
      `deleting Storage v2 sync probe ${probePath}`,
      () => maybeDeleteFile.call(client, probePath),
      { logger }
    ).catch((error) => {
      logger.warn(`Failed to delete Storage v2 sync probe ${probePath}`, error as Error)
    })
  }

  private async readJson<T>(client: WebDAVClient, filePath: string): Promise<T | null> {
    try {
      if (
        !(await runWebDavOperation(`checking Storage v2 sync record ${filePath}`, () => client.exists(filePath), {
          logger
        }))
      ) {
        return null
      }
      const contents = await runWebDavOperation(
        `reading Storage v2 sync record ${filePath}`,
        () => client.getFileContents(filePath, { format: 'binary' }),
        { logger }
      )
      return JSON.parse(bufferToString(contents)) as T
    } catch (error) {
      if (error instanceof WebDavOperationError && error.transient) {
        throw error
      }

      logger.warn(`Failed to read Storage v2 sync record ${filePath}`, error as Error)
      return null
    }
  }

  private async hasRemoteRecord(
    client: WebDAVClient,
    basePath: string,
    meta: RemoteRecordMeta,
    bundledRecord?: LocalRecord | null
  ) {
    if (isBundleRecordPath(meta.path)) {
      return Boolean(bundledRecord)
    }

    try {
      const relativePath = safeRemoteRelativePath(meta.path)
      const remotePath = path.posix.join(basePath, relativePath)
      return await runWebDavOperation(
        `checking Storage v2 sync record existence ${remotePath}`,
        () => client.exists(remotePath),
        { logger }
      )
    } catch {
      return false
    }
  }

  private async writeJson(
    client: WebDAVClient,
    filePath: string,
    data: unknown,
    options: { overwrite?: boolean } = {}
  ) {
    await this.ensureDirectory(client, path.posix.dirname(filePath))
    await writeWebDavJsonAtomically(client, filePath, data, {
      logger,
      operation: 'Storage v2 sync record',
      overwrite: options.overwrite
    })
  }

  private normalizeBundledRecord(id: string, record: LocalRecord | null | undefined): LocalRecord | null {
    if (!record?.row || !record?.table?.entityType || !Array.isArray(record.idValues)) return null

    const table = this.tableByEntity(record.table.entityType)
    if (!table) return null

    const normalizedId = recordId(table.entityType, record.idValues)
    if (normalizedId !== id) return null

    const valueHash = hashJson(record.row)
    return {
      ...record,
      id,
      table,
      idValues: record.idValues,
      valueHash,
      updatedAt: parseTime(record.updatedAt),
      deletedAt: parseTime(record.deletedAt) || null,
      version: Number(record.version ?? 1)
    }
  }

  private async readRecordBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest
  ): Promise<StorageV2WebDavRecordSyncBundle | null> {
    if (!manifest.bundle?.path) return null

    const bundle = await this.readJson<StorageV2WebDavRecordSyncBundle>(
      client,
      path.posix.join(basePath, safeRemoteRelativePath(manifest.bundle.path))
    )
    if (!bundle?.records || typeof bundle.records !== 'object') return null

    const records = Object.entries(bundle.records).reduce<Record<string, LocalRecord>>((result, [id, record]) => {
      const normalized = this.normalizeBundledRecord(id, record)
      if (normalized) {
        result[id] = normalized
      }
      return result
    }, {})
    const normalizedBundle: StorageV2WebDavRecordSyncBundle = {
      version: 1,
      updatedAt: parseTime(bundle.updatedAt) || Date.now(),
      records,
      blobs: bundle.blobs ?? {}
    }
    const valueHash = bundleHash(normalizedBundle)
    if (manifest.bundle.valueHash && manifest.bundle.valueHash !== valueHash) {
      throw new Error(
        '远端 Storage v2 数据包校验失败。为避免覆盖或导入损坏数据，本次同步已停止，请重新同步或从安全快照恢复。'
      )
    }

    return normalizedBundle
  }

  private buildBundle(
    recordsById: Map<string, LocalRecord>,
    blobs: Record<string, RemoteBlobMeta>
  ): StorageV2WebDavRecordSyncBundle {
    const records = this.sortRecordIds(recordsById.keys()).reduce<Record<string, LocalRecord>>((result, id) => {
      const record = recordsById.get(id)
      if (record) {
        result[id] = record
      }
      return result
    }, {})
    const updatedAt = Math.max(
      0,
      ...Object.values(records).map((record) => record.updatedAt),
      ...Object.values(blobs).map((blob) => blob.updatedAt)
    )

    return {
      version: 1,
      updatedAt,
      records,
      blobs
    }
  }

  private async writeRecordBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    recordsById: Map<string, LocalRecord>
  ) {
    const bundle = this.buildBundle(recordsById, manifest.blobs)
    const valueHash = bundleHash(bundle)
    const relativePath = recordBundlePath(valueHash)
    await this.writeJson(client, path.posix.join(basePath, relativePath), bundle, { overwrite: false })

    manifest.records = Object.fromEntries(
      Object.entries(bundle.records).map(([id, record]) => [id, recordMetaFromLocalRecord(record, relativePath)])
    )
    manifest.blobs = bundle.blobs
    manifest.bundle = {
      version: 1,
      path: relativePath,
      valueHash,
      recordCount: Object.keys(bundle.records).length,
      blobCount: Object.keys(bundle.blobs).length,
      updatedAt: bundle.updatedAt
    }
  }

  private async getTableColumns(client: Client, tableName: string) {
    const cached = this.columnsByTable.get(tableName)
    if (cached) return cached

    const result = await client.execute(`PRAGMA table_info(${tableName})`)
    const columns = result.rows.map((row) => String(row.name)).filter(Boolean)
    this.columnsByTable.set(tableName, columns)
    return columns
  }

  private async listLocalRecords(client: Client): Promise<LocalRecord[]> {
    const records: LocalRecord[] = []

    for (const table of this.tables) {
      const result = await client.execute(`SELECT * FROM ${table.table}`)
      for (const sourceRow of result.rows) {
        const row = rowToPlain(sourceRow as Record<string, unknown>)
        const idValues = table.idColumns.map((column) => String(row[column] ?? ''))
        if (idValues.some((value) => !value)) continue

        const deletedAt = table.deletedAtColumn ? parseTime(row[table.deletedAtColumn]) || null : null
        const updatedAt = table.updatedAtColumn ? parseTime(row[table.updatedAtColumn]) : 0
        const version = table.versionColumn ? Number(row[table.versionColumn] ?? 1) : 1

        records.push({
          id: recordId(table.entityType, idValues),
          table,
          idValues,
          row,
          valueHash: hashJson(row),
          updatedAt,
          deletedAt,
          version
        })
      }
    }

    return records
  }

  private async getRecordSyncState(client: Client, id: string): Promise<string | null> {
    const result = await client.execute({
      sql: 'SELECT value_json FROM sync_state WHERE key = ?',
      args: [`webdav-storage-record:${id}:hash`]
    })
    const value = result.rows[0]?.value_json
    if (typeof value !== 'string') return null

    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }

  private async setRecordSyncState(client: Client, id: string, hash: string) {
    await client.execute({
      sql: `
        INSERT INTO sync_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
      args: [`webdav-storage-record:${id}:hash`, JSON.stringify(hash), new Date().toISOString()]
    })
  }

  private async recordConflictAudit(
    client: Client,
    input: {
      localRecord: LocalRecord
      remoteRecord: LocalRecord
      baseHash?: string | null
      resolvedAt?: string | null
    }
  ) {
    const createdAt = new Date().toISOString()
    await client.execute({
      sql: `
        INSERT INTO sync_conflicts (
          id, entity_type, entity_id, local_snapshot_json, remote_snapshot_json,
          base_version, created_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          local_snapshot_json = excluded.local_snapshot_json,
          remote_snapshot_json = excluded.remote_snapshot_json,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `,
      args: [
        `webdav-storage-record:${input.localRecord.id}:${Date.now()}`,
        input.localRecord.table.entityType,
        input.localRecord.id,
        JSON.stringify({
          id: input.localRecord.id,
          idValues: input.localRecord.idValues,
          row: input.localRecord.row,
          valueHash: input.localRecord.valueHash,
          updatedAt: input.localRecord.updatedAt,
          deletedAt: input.localRecord.deletedAt,
          version: input.localRecord.version
        }),
        JSON.stringify({
          id: input.remoteRecord.id,
          idValues: input.remoteRecord.idValues,
          row: input.remoteRecord.row,
          valueHash: input.remoteRecord.valueHash,
          updatedAt: input.remoteRecord.updatedAt,
          deletedAt: input.remoteRecord.deletedAt,
          version: input.remoteRecord.version,
          baseHash: input.baseHash ?? null
        }),
        createdAt,
        input.resolvedAt ?? null
      ]
    })
  }

  private async pushRecord(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    bundledRecords?: Map<string, LocalRecord>
  ) {
    if (bundledRecords) {
      bundledRecords.set(record.id, record)
      manifest.records[record.id] = recordMetaFromLocalRecord(record, recordBundlePath())
      return
    }

    const relativePath = recordPath(record)
    await this.writeJson(client, path.posix.join(basePath, relativePath), record)

    manifest.records[record.id] = recordMetaFromLocalRecord(record, relativePath)
  }

  private async pullRecord(
    client: WebDAVClient,
    basePath: string,
    meta: RemoteRecordMeta,
    bundledRecord?: LocalRecord | null
  ) {
    if (!bundledRecord && isBundleRecordPath(meta.path)) return null

    const record =
      bundledRecord ??
      (await this.readJson<LocalRecord>(client, path.posix.join(basePath, safeRemoteRelativePath(meta.path))))
    if (!record?.row || !record?.table) return null
    const table = this.tableByEntity(meta.entityType)
    if (!table) return null

    const valueHash = hashJson(record.row)
    if (valueHash !== meta.valueHash) {
      logger.warn('Remote Storage v2 record hash mismatch', {
        entityType: meta.entityType,
        expected: meta.valueHash,
        actual: valueHash,
        idValues: meta.idValues
      })
    }

    return {
      ...record,
      id: recordId(meta.entityType, meta.idValues),
      table,
      idValues: meta.idValues,
      valueHash,
      updatedAt: meta.updatedAt,
      deletedAt: meta.deletedAt ?? null,
      version: meta.version
    }
  }

  private areRecordRowsEquivalent(left: LocalRecord, right: LocalRecord) {
    return (
      left.table.entityType === right.table.entityType &&
      left.deletedAt === right.deletedAt &&
      hashJson(left.row) === hashJson(right.row)
    )
  }

  private async getLocalSkillIdByFolderName(client: Client, folderName: string) {
    const result = await client.execute({
      sql: 'SELECT id FROM skills WHERE folder_name = ? LIMIT 1',
      args: [folderName]
    })
    const id = result.rows[0]?.id
    return typeof id === 'string' && id ? id : null
  }

  private rewriteAgentSkillRow(row: Record<string, InValue>) {
    const skillId = typeof row.skill_id === 'string' ? row.skill_id : ''
    const mappedSkillId = this.skillIdRemaps.get(skillId)
    if (!mappedSkillId) return row

    return {
      ...row,
      skill_id: mappedSkillId
    }
  }

  private rewriteAgentSkillEntityId(entityId: string) {
    const parts = entityId.split(':')
    if (parts.length !== 2) return entityId

    const mappedSkillId = this.skillIdRemaps.get(parts[1])
    return mappedSkillId ? `${parts[0]}:${mappedSkillId}` : entityId
  }

  private async rewriteRemoteRowForLocalAliases(
    client: Client,
    table: StorageV2SyncTable,
    row: Record<string, InValue>
  ) {
    if (table.entityType === 'skill') {
      const remoteSkillId = typeof row.id === 'string' ? row.id : ''
      const folderName = typeof row.folder_name === 'string' ? row.folder_name : ''
      if (!remoteSkillId || !folderName) return row

      const localSkillId = await this.getLocalSkillIdByFolderName(client, folderName)
      if (!localSkillId || localSkillId === remoteSkillId) return row

      this.skillIdRemaps.set(remoteSkillId, localSkillId)
      return {
        ...row,
        id: localSkillId
      }
    }

    if (table.entityType === 'agent_skill') {
      return this.rewriteAgentSkillRow(row)
    }

    if (table.entityType === TOMBSTONE_ENTITY_TYPE) {
      const entityType = typeof row.entity_type === 'string' ? row.entity_type : ''
      const entityId = typeof row.entity_id === 'string' ? row.entity_id : ''
      if (entityType !== 'agent_skill' || !entityId) return row

      const mappedEntityId = this.rewriteAgentSkillEntityId(entityId)
      return mappedEntityId === entityId
        ? row
        : {
            ...row,
            entity_id: mappedEntityId
          }
    }

    return row
  }

  private async applyRemoteRecord(client: Client, remote: LocalRecord) {
    const table = this.tableByEntity(remote.table.entityType)
    if (!table) return false

    const row = await this.rewriteRemoteRowForLocalAliases(client, table, remote.row)
    const columns = await this.getTableColumns(client, table.table)
    const insertColumns = columns.filter((column) => Object.hasOwn(row, column))
    if (insertColumns.length === 0) return false

    const updateColumns = insertColumns.filter((column) => !table.idColumns.includes(column))
    const conflictTarget = table.idColumns.join(', ')
    const updateSql =
      updateColumns.length > 0
        ? `DO UPDATE SET ${updateColumns.map((column) => `${column} = excluded.${column}`).join(', ')}`
        : 'DO NOTHING'

    await client.execute({
      sql: `
        INSERT INTO ${table.table} (${insertColumns.join(', ')})
        VALUES (${insertColumns.map(() => '?').join(', ')})
        ON CONFLICT(${conflictTarget}) ${updateSql}
      `,
      args: insertColumns.map((column) => row[column] ?? null)
    })

    await this.applyTombstoneTarget(client, row)
    return true
  }

  private async applyTombstoneTarget(client: Client, row: Record<string, unknown>) {
    const target = tombstoneTargetFromRow(row)
    if (!target) return false

    const targetTable =
      TOMBSTONE_PHYSICAL_DELETE_TARGETS[target.entityType as keyof typeof TOMBSTONE_PHYSICAL_DELETE_TARGETS]
    await client.execute({
      sql: `
        DELETE FROM ${targetTable.table}
        WHERE ${targetTable.idColumns.map((column) => `${column} = ?`).join(' AND ')}
      `,
      args: target.idValues
    })

    return true
  }

  private pruneManifestRecordCoveredByTombstone(
    manifest: StorageV2WebDavRecordSyncManifest,
    row: Record<string, unknown>,
    bundledRecords?: Map<string, LocalRecord>
  ) {
    const target = tombstoneTargetFromRow(row)
    if (!target) return

    const id = recordId(target.entityType, target.idValues)
    delete manifest.records[id]
    bundledRecords?.delete(id)
  }

  private async applyLocalTombstoneRecord(
    client: Client,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    bundledRecords?: Map<string, LocalRecord>
  ) {
    if (record.table.entityType !== TOMBSTONE_ENTITY_TYPE) return

    await this.applyTombstoneTarget(client, record.row)
    this.pruneManifestRecordCoveredByTombstone(manifest, record.row, bundledRecords)
  }

  private async isCoveredByLocalTombstone(client: Client, meta: RemoteRecordMeta) {
    const target = tombstoneTargetFromRecord(meta.entityType, meta.idValues)
    if (!target) return false

    const result = await client.execute({
      sql: `
        SELECT deleted_at
        FROM sync_tombstones
        WHERE entity_type = ? AND entity_id = ?
      `,
      args: [target.entityType, target.entityId]
    })
    const tombstoneDeletedAt = parseTime(result.rows[0]?.deleted_at)
    return tombstoneDeletedAt > 0 && tombstoneDeletedAt >= meta.updatedAt
  }

  private blobLocalPath(storagePath: string) {
    const dataRoot = storageV2DataRootService.ensureDataRoot().dataRoot
    return path.join(dataRoot, normalizeLocalStoragePath(storagePath))
  }

  private async pushBlobFile(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    summary: StorageV2WebDavRecordSyncSummary
  ) {
    const storagePathColumn = record.table.blobStoragePathColumn
    const checksumColumn = record.table.blobChecksumColumn
    if (!storagePathColumn || !checksumColumn) return

    const blobId = record.idValues[0]
    const storagePath = String(record.row[storagePathColumn] ?? '')
    const checksum = String(record.row[checksumColumn] ?? '')
    if (!blobId || !storagePath || !checksum) return

    const localPath = this.blobLocalPath(storagePath)
    if (!fs.existsSync(localPath)) return

    const stat = await fsp.stat(localPath)
    const remote = manifest.blobs[blobId]
    if (remote?.checksum === checksum && remote.byteSize === stat.size) return

    const relativePath = blobPath(blobId, checksum)
    await this.ensureDirectory(client, path.posix.dirname(path.posix.join(basePath, relativePath)))
    const remotePath = path.posix.join(basePath, relativePath)
    await runWebDavOperation(
      `uploading Storage v2 blob ${remotePath}`,
      () =>
        client.putFileContents(remotePath, fs.createReadStream(localPath), {
          overwrite: true,
          contentLength: stat.size
        }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )

    manifest.blobs[blobId] = {
      id: blobId,
      checksum,
      byteSize: stat.size,
      storagePath,
      path: relativePath,
      updatedAt: record.updatedAt
    }
    summary.blobUploaded += 1
  }

  private async ensureRemoteBlobFile(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    summary: StorageV2WebDavRecordSyncSummary
  ) {
    if (record.table.entityType !== 'blob') return

    const blobId = record.idValues[0]
    const blob = manifest.blobs[blobId]
    if (!blob) return

    const localPath = this.blobLocalPath(blob.storagePath)
    if (fs.existsSync(localPath)) {
      try {
        if ((await sha256File(localPath)) === blob.checksum) return
      } catch {
        // fall through and redownload the blob
      }
    }

    const remotePath = path.posix.join(basePath, safeRemoteRelativePath(blob.path))
    const contents = await runWebDavOperation(
      `downloading Storage v2 blob ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    await fsp.mkdir(path.dirname(localPath), { recursive: true })
    await fsp.writeFile(localPath, bufferFromRemoteContents(contents))
    summary.blobDownloaded += 1
  }

  private sortRecordIds(ids: Iterable<string>) {
    return Array.from(ids).sort((left, right) => {
      const leftEntity = left.slice(0, left.indexOf(':'))
      const rightEntity = right.slice(0, right.indexOf(':'))
      const weightDiff = tableWeight(this.tables, leftEntity) - tableWeight(this.tables, rightEntity)
      return weightDiff !== 0 ? weightDiff : left.localeCompare(right)
    })
  }

  async sync(
    client: WebDAVClient,
    basePath: string,
    manifestInput?: StorageV2WebDavRecordSyncManifest | null
  ): Promise<{ manifest: StorageV2WebDavRecordSyncManifest; summary: StorageV2WebDavRecordSyncSummary }> {
    this.skillIdRemaps.clear()
    const dbClient = await storageV2Database.getClient()
    const manifest = normalizeManifest(manifestInput ?? makeManifest())
    const summary = { ...EMPTY_SUMMARY }
    await this.ensureDirectory(client, basePath)
    await this.assertWriteAccess(client, basePath)
    const localRecords = await this.listLocalRecords(dbClient)
    const localById = new Map(localRecords.map((record) => [record.id, record]))
    const remoteBundle = await this.readRecordBundle(client, basePath, manifest)
    const bundledRecords = new Map<string, LocalRecord>(Object.entries(remoteBundle?.records ?? {}))
    if (remoteBundle) {
      manifest.blobs = {
        ...manifest.blobs,
        ...remoteBundle.blobs
      }
      for (const record of bundledRecords.values()) {
        manifest.records[record.id] = recordMetaFromLocalRecord(record, recordBundlePath())
      }
    }
    const ids = this.sortRecordIds(new Set([...localById.keys(), ...Object.keys(manifest.records)]))

    for (const id of ids) {
      const localRecord = localById.get(id)
      const remoteMeta = manifest.records[id]
      const bundledRecord = bundledRecords.get(id)
      const lastHash = await this.getRecordSyncState(dbClient, id)

      if (localRecord && !remoteMeta) {
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localRecord && remoteMeta) {
        if (await this.isCoveredByLocalTombstone(dbClient, remoteMeta)) {
          delete manifest.records[id]
          bundledRecords.delete(id)
          summary.storageSkipped += 1
          continue
        }

        const remoteRecord = await this.pullRecord(client, basePath, remoteMeta, bundledRecord)
        if (remoteRecord && (await this.applyRemoteRecord(dbClient, remoteRecord))) {
          bundledRecords.set(id, remoteRecord)
          manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
          await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
          summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
          summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        }
        continue
      }

      if (!localRecord || !remoteMeta) {
        summary.storageSkipped += 1
        continue
      }

      if (localRecord.valueHash === remoteMeta.valueHash) {
        const remoteRecordAccessible = await this.hasRemoteRecord(client, basePath, remoteMeta, bundledRecord)
        if (!remoteRecordAccessible) {
          await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords)
          await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
          await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
          await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
          summary.storageUploaded += localRecord.deletedAt ? 0 : 1
          summary.storageDeleted += localRecord.deletedAt ? 1 : 0
          continue
        }

        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        bundledRecords.set(id, localRecord)
        manifest.records[id] = recordMetaFromLocalRecord(localRecord, recordBundlePath())
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageSkipped += 1
        continue
      }

      const localChanged = localRecord.valueHash !== lastHash
      const remoteRecord = await this.pullRecord(client, basePath, remoteMeta, bundledRecord)
      if (!remoteRecord) {
        summary.storageSkipped += 1
        continue
      }

      if (this.areRecordRowsEquivalent(localRecord, remoteRecord)) {
        const localWins =
          localRecord.updatedAt > remoteRecord.updatedAt ||
          (localRecord.updatedAt === remoteRecord.updatedAt && localRecord.version >= remoteRecord.version)
        const remoteWins = !localWins
        const winner = localWins ? localRecord : remoteRecord

        if (remoteWins && !(await this.applyRemoteRecord(dbClient, remoteRecord))) {
          summary.storageSkipped += 1
          continue
        }

        bundledRecords.set(id, winner)
        manifest.records[id] = recordMetaFromLocalRecord(winner, recordBundlePath())
        await this.setRecordSyncState(dbClient, id, winner.valueHash)
        this.pruneManifestRecordCoveredByTombstone(manifest, winner.row, bundledRecords)
        if (!localWins && remoteWins) {
          await this.ensureRemoteBlobFile(client, basePath, manifest, winner, summary)
        }
        await this.applyLocalTombstoneRecord(dbClient, manifest, winner, bundledRecords)
        summary.storageSkipped += 1
        continue
      }

      const remoteChanged = remoteRecord.valueHash !== lastHash

      if (!lastHash) {
        if (await this.applyRemoteRecord(dbClient, remoteRecord)) {
          bundledRecords.set(id, remoteRecord)
          manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
          await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
          summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
          summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        } else {
          summary.storageSkipped += 1
        }
        continue
      }

      if (localChanged && !remoteChanged) {
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localChanged && remoteChanged) {
        if (await this.applyRemoteRecord(dbClient, remoteRecord)) {
          bundledRecords.set(id, remoteRecord)
          manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
          await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
          summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
          summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        }
        continue
      }

      const localWins =
        localRecord.updatedAt > remoteRecord.updatedAt ||
        (localRecord.updatedAt === remoteRecord.updatedAt && localRecord.version >= remoteRecord.version)
      if (localWins) {
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
      } else if (await this.applyRemoteRecord(dbClient, remoteRecord)) {
        bundledRecords.set(id, remoteRecord)
        manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
        await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
        this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
        await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
        summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
      }
      if (localRecord.updatedAt === remoteRecord.updatedAt && localRecord.version === remoteRecord.version) {
        await this.recordConflictAudit(dbClient, {
          localRecord,
          remoteRecord,
          baseHash: lastHash,
          resolvedAt: null
        })
        summary.storageConflicts += 1
      } else {
        await this.recordConflictAudit(dbClient, {
          localRecord,
          remoteRecord,
          baseHash: lastHash,
          resolvedAt: new Date().toISOString()
        })
        summary.storageResolvedConflicts += 1
      }
    }

    await this.writeRecordBundle(client, basePath, manifest, bundledRecords)
    return { manifest, summary }
  }
}

export const storageV2WebDavRecordSyncService = new StorageV2WebDavRecordSyncService()
