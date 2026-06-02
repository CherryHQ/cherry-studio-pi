import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { Client, InValue } from '@libsql/client'
import { loggerService } from '@logger'
import { runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import type { WebDAVClient } from 'webdav'

import { storageV2DataRootService } from './DataRootService'
import { storageV2Database } from './StorageV2Database'

const logger = loggerService.withContext('StorageV2WebDavRecordSyncService')

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

export type StorageV2WebDavRecordSyncManifest = {
  version: 1
  records: Record<string, RemoteRecordMeta>
  blobs: Record<string, RemoteBlobMeta>
}

export type StorageV2WebDavRecordSyncSummary = {
  storageUploaded: number
  storageDownloaded: number
  storageDeleted: number
  storageConflicts: number
  storageSkipped: number
  blobUploaded: number
  blobDownloaded: number
}

const EMPTY_SUMMARY: StorageV2WebDavRecordSyncSummary = {
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageSkipped: 0,
  blobUploaded: 0,
  blobDownloaded: 0
}

const TOMBSTONE_ENTITY_TYPE = 'sync_tombstone'
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
  return { version: 1, records: {}, blobs: {} }
}

function normalizeManifest(manifest?: StorageV2WebDavRecordSyncManifest | null): StorageV2WebDavRecordSyncManifest {
  return {
    version: 1,
    records: manifest?.records ?? {},
    blobs: manifest?.blobs ?? {}
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

function recordId(entityType: string, idValues: readonly string[]) {
  return `${entityType}:${idValues.map((value) => encodePart(value)).join(':')}`
}

function recordPath(record: Pick<LocalRecord, 'id' | 'table'>) {
  return `storage-v2/records/${encodePart(record.table.entityType)}/${hashJson(record.id)}.json`
}

function blobPath(blobId: string) {
  return `storage-v2/blobs/${encodePart(blobId)}`
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

  private async writeJson(client: WebDAVClient, filePath: string, data: unknown) {
    await this.ensureDirectory(client, path.posix.dirname(filePath))
    await runWebDavOperation(
      `writing Storage v2 sync record ${filePath}`,
      () => client.putFileContents(filePath, JSON.stringify(data, null, 2), { overwrite: true }),
      { logger }
    )
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

  private async pushRecord(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord
  ) {
    const relativePath = recordPath(record)
    await this.writeJson(client, path.posix.join(basePath, relativePath), record)

    manifest.records[record.id] = {
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

  private async pullRecord(client: WebDAVClient, basePath: string, meta: RemoteRecordMeta) {
    const record = await this.readJson<LocalRecord>(
      client,
      path.posix.join(basePath, safeRemoteRelativePath(meta.path))
    )
    if (!record?.row || !record?.table) return null
    const table = this.tableByEntity(meta.entityType)
    if (!table) return null

    const valueHash = hashJson(record.row)
    if (valueHash !== meta.valueHash) {
      logger.warn('Remote Storage v2 record hash mismatch', {
        entityType: meta.entityType,
        idValues: meta.idValues
      })
      return null
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
    row: Record<string, unknown>
  ) {
    const target = tombstoneTargetFromRow(row)
    if (!target) return

    delete manifest.records[recordId(target.entityType, target.idValues)]
  }

  private async applyLocalTombstoneRecord(
    client: Client,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord
  ) {
    if (record.table.entityType !== TOMBSTONE_ENTITY_TYPE) return

    await this.applyTombstoneTarget(client, record.row)
    this.pruneManifestRecordCoveredByTombstone(manifest, record.row)
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

    const relativePath = blobPath(blobId)
    await this.ensureDirectory(client, path.posix.dirname(path.posix.join(basePath, relativePath)))
    const remotePath = path.posix.join(basePath, relativePath)
    await runWebDavOperation(
      `uploading Storage v2 blob ${remotePath}`,
      () =>
        client.putFileContents(remotePath, fs.createReadStream(localPath), {
          overwrite: true,
          contentLength: stat.size
        }),
      { logger }
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
      { logger }
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
    const ids = this.sortRecordIds(new Set([...localById.keys(), ...Object.keys(manifest.records)]))

    for (const id of ids) {
      const localRecord = localById.get(id)
      const remoteMeta = manifest.records[id]
      const lastHash = await this.getRecordSyncState(dbClient, id)

      if (localRecord && !remoteMeta) {
        await this.pushRecord(client, basePath, manifest, localRecord)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localRecord && remoteMeta) {
        if (await this.isCoveredByLocalTombstone(dbClient, remoteMeta)) {
          delete manifest.records[id]
          summary.storageSkipped += 1
          continue
        }

        const remoteRecord = await this.pullRecord(client, basePath, remoteMeta)
        if (remoteRecord && (await this.applyRemoteRecord(dbClient, remoteRecord))) {
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row)
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
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageSkipped += 1
        continue
      }

      const localChanged = localRecord.valueHash !== lastHash
      const remoteChanged = remoteMeta.valueHash !== lastHash

      if (!lastHash) {
        const remoteRecord = await this.pullRecord(client, basePath, remoteMeta)
        if (remoteRecord && (await this.applyRemoteRecord(dbClient, remoteRecord))) {
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row)
          await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
          summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
          summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        } else {
          summary.storageSkipped += 1
        }
        continue
      }

      if (localChanged && !remoteChanged) {
        await this.pushRecord(client, basePath, manifest, localRecord)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      const remoteRecord = await this.pullRecord(client, basePath, remoteMeta)
      if (!remoteRecord) {
        summary.storageSkipped += 1
        continue
      }

      if (!localChanged && remoteChanged) {
        if (await this.applyRemoteRecord(dbClient, remoteRecord)) {
          await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row)
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
        await this.pushRecord(client, basePath, manifest, localRecord)
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary)
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord)
        await this.setRecordSyncState(dbClient, id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
      } else if (await this.applyRemoteRecord(dbClient, remoteRecord)) {
        await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary)
        this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row)
        await this.setRecordSyncState(dbClient, id, remoteRecord.valueHash)
        summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
      }
      summary.storageConflicts += 1
    }

    return { manifest, summary }
  }
}

export const storageV2WebDavRecordSyncService = new StorageV2WebDavRecordSyncService()
