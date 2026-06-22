import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { Client, InValue } from '@libsql/client'
import { loggerService } from '@logger'
import { writeWebDavJsonAtomically } from '@main/services/WebDavAtomic'
import { runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import { getErrorMessage as getMainErrorMessage } from '@main/utils/errorMessage'
import type { WebDAVClient } from 'webdav'

import { storageV2DataRootService } from './DataRootService'
import { isProviderAuthConfigSecretKey, isSensitiveHeaderName } from './SecretFieldDetection'
import {
  collectStorageV2SecretRefsFromValue,
  scanStorageV2SecretReferences,
  STORAGE_V2_SECRET_REF_PREFIX
} from './SecretRefIntegrity'
import { type StorageV2PlaintextSecretVaultEntry, storageV2SecretVaultService } from './SecretVaultService'
import { storageV2Database } from './StorageV2Database'
import {
  decodeStorageV2CompositeEntityId,
  encodeStorageV2CompositeEntityId,
  listStorageV2CompositeEntityIdCandidates
} from './SyncEntityId'
import { listStorageV2SyncPolicies, type StorageV2SyncEntityType, type StorageV2SyncPolicy } from './SyncPolicy'

const logger = loggerService.withContext('StorageV2WebDavRecordSyncService')
const LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000
const MAX_SYNC_RECORD_JSON_BYTES = 2 * 1024 * 1024
const MAX_SYNC_RECORD_BUNDLE_JSON_BYTES = 64 * 1024 * 1024
const MAX_SYNC_RECORD_REMOTE_JSON_BYTES = MAX_SYNC_RECORD_JSON_BYTES * 2
const MAX_SYNC_RECORD_BUNDLE_REMOTE_JSON_BYTES = MAX_SYNC_RECORD_BUNDLE_JSON_BYTES * 2
const MAX_SYNC_BLOB_BYTES = 64 * 1024 * 1024
const MAX_SYNC_SECRET_BUNDLE_JSON_BYTES = 8 * 1024 * 1024
const MAX_SYNC_SECRET_COUNT = 10_000
const DATA_SYNC_CLEANUP_MAX_FILES_ENV = 'CHERRY_STUDIO_DATA_SYNC_CLEANUP_MAX_FILES'
const DEFAULT_REMOTE_ARTIFACT_CLEANUP_MAX_FILES = 20_000

function remoteDirectoryEntryPath(entry: { filename?: string; basename?: string }, currentPath: string) {
  if (typeof entry.filename === 'string' && entry.filename.trim()) {
    const filename = entry.filename.trim()
    return path.posix.isAbsolute(filename) ? filename : path.posix.join(currentPath, filename)
  }
  if (typeof entry.basename === 'string' && entry.basename.trim()) {
    return path.posix.join(currentPath, entry.basename)
  }
  return null
}

function withStorageWebDavSignal<T extends Record<string, unknown>>(
  options: T,
  signal?: AbortSignal
): T & { signal?: AbortSignal } {
  return signal ? { ...options, signal } : options
}

function webDavExists(client: WebDAVClient, filePath: string, signal?: AbortSignal) {
  return signal ? client.exists(filePath, { signal }) : client.exists(filePath)
}

function webDavGetDirectoryContents(client: WebDAVClient, filePath: string, signal?: AbortSignal) {
  return signal ? client.getDirectoryContents(filePath, { signal }) : client.getDirectoryContents(filePath)
}

type StorageV2SyncTable = {
  entityType: StorageV2SyncEntityType
  table: string
  idColumns: readonly string[]
  syncIdColumns?: readonly string[]
  updatedAtColumn?: string
  deletedAtColumn?: string
  versionColumn?: string
  blobStoragePathColumn?: string
  blobChecksumColumn?: string
  omitColumnsFromSync?: readonly string[]
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

type RemoteSecretVaultMeta = {
  version: 1
  path: string
  valueHash: string
  secretCount: number
  updatedAt: number
  encryption: 'cherry-webdav-secret-sync-aes-256-gcm'
}

type RemoteEncryptedSecretEntry = {
  encrypted: string
  iv: string
  authTag: string
  updatedAt: string
}

type RemoteSecretVaultBundle = {
  version: 1
  updatedAt: number
  secrets: Record<string, RemoteEncryptedSecretEntry>
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
  secrets?: RemoteSecretVaultMeta | null
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
  secretUploaded: number
  secretDownloaded: number
}

export type StorageV2WebDavRecordSyncStateCommit = {
  id: string
  valueHash: string
}

export type StorageV2WebDavRecordSyncResult = {
  manifest: StorageV2WebDavRecordSyncManifest
  summary: StorageV2WebDavRecordSyncSummary
  syncStates: StorageV2WebDavRecordSyncStateCommit[]
}

type StorageV2WebDavRecordSyncOptions = {
  secretKeyMaterial?: string
  legacySecretKeyMaterial?: string
  beforeRemoteConflictApply?: (input: { id: string; baseHash: string | null; firstJoin: boolean }) => Promise<void>
  preferRemoteOnFirstJoin?: boolean
  skipWriteAccessProbe?: boolean
  assertActive?: () => void
  signal?: AbortSignal
}

type RemoteSecretVaultCache = {
  loaded: boolean
  secrets: Record<string, StorageV2PlaintextSecretVaultEntry> | null
  importedSecretIds: Set<string>
}

const EMPTY_SUMMARY: StorageV2WebDavRecordSyncSummary = {
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageResolvedConflicts: 0,
  storageSkipped: 0,
  blobUploaded: 0,
  blobDownloaded: 0,
  secretUploaded: 0,
  secretDownloaded: 0
}

const TOMBSTONE_ENTITY_TYPE: StorageV2SyncEntityType = 'sync_tombstone'
const STORAGE_V2_LEGACY_RECORD_BUNDLE_PATH = 'storage-v2/bundle/current.json'
const STORAGE_V2_BUNDLE_DIR = 'storage-v2/bundle'
const STORAGE_V2_SECRET_VAULT_DIR = 'storage-v2/secrets'
const SECRET_SYNC_KEY_CONTEXT = 'cherry-studio-pi:webdav-secret-sync:v1'
const SECRET_SYNC_ENCRYPTION = 'cherry-webdav-secret-sync-aes-256-gcm' as const
const GCM_IV_BYTE_LENGTH = 12
const FIRST_JOIN_DEFER_LOCAL_ONLY_ENTITY_TYPES = new Set<StorageV2SyncEntityType>([
  'agent',
  'agent_session',
  'agent_skill',
  'agent_version',
  'assistant',
  'assistant_version',
  'blob',
  'channel',
  'channel_task_subscription',
  'conversation',
  'file',
  'knowledge_base',
  'knowledge_item',
  'kv_record',
  'message',
  'message_block',
  'model',
  'profile',
  'provider',
  'provider_credential',
  'scheduled_task',
  'settings',
  'skill',
  'sync_tombstone'
])
const TOMBSTONE_PHYSICAL_DELETE_TARGETS = {
  provider_credential: {
    table: 'provider_credentials',
    idColumns: ['provider_id', 'credential_kind']
  },
  agent_skill: {
    table: 'agent_skills',
    idColumns: ['agent_id', 'skill_id']
  },
  channel_task_subscription: {
    table: 'channel_task_subscriptions',
    idColumns: ['channel_id', 'task_id']
  }
} as const

class RemoteSyncSizeLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteSyncSizeLimitError'
  }
}

function errorMessage(error: unknown) {
  return getMainErrorMessage(error, '未知 Storage v2 同步错误')
}

function parseJsonCell(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const STORAGE_V2_SYNC_TABLE_OVERRIDES = {
  blob: {
    blobStoragePathColumn: 'storage_path',
    blobChecksumColumn: 'checksum'
  },
  task_run_log: {
    updatedAtColumn: 'run_at',
    omitColumnsFromSync: ['id']
  }
} as const satisfies Partial<
  Record<StorageV2SyncEntityType, Partial<Omit<StorageV2SyncTable, 'entityType' | 'table' | 'idColumns'>>>
>

function storageV2SyncTableFromPolicy(policy: StorageV2SyncPolicy): StorageV2SyncTable {
  const table: StorageV2SyncTable = {
    entityType: policy.entityType,
    table: policy.table,
    idColumns: policy.idColumns
  }

  if (policy.syncIdentityColumns) table.syncIdColumns = policy.syncIdentityColumns
  if (policy.updatedAtColumn) table.updatedAtColumn = policy.updatedAtColumn
  if (policy.deletedAtColumn) table.deletedAtColumn = policy.deletedAtColumn
  if (policy.versioned) table.versionColumn = 'version'

  return {
    ...table,
    ...STORAGE_V2_SYNC_TABLE_OVERRIDES[policy.entityType]
  }
}

const STORAGE_V2_SYNC_TABLES: readonly StorageV2SyncTable[] =
  listStorageV2SyncPolicies().map(storageV2SyncTableFromPolicy)

function makeManifest(): StorageV2WebDavRecordSyncManifest {
  return { version: 1, records: {}, blobs: {}, bundle: null }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeManifestObjectMap<T>(
  value: unknown,
  label: string,
  normalizeEntry: (id: string, value: unknown) => T
) {
  if (value == null) return {}
  if (!isPlainRecord(value)) {
    throw new Error(`${label} 格式损坏。为避免把损坏的远端同步状态当作空数据覆盖，本次同步已停止。`)
  }

  return Object.fromEntries(Object.entries(value).map(([id, entry]) => [id, normalizeEntry(id, entry)]))
}

function normalizeRemoteManifestCount(value: unknown, label: string) {
  if (value == null) return 0
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} 数量字段损坏。为避免导入或发布不完整数据，本次同步已停止。`)
  }
  return count
}

function normalizeRemoteRecordMetaMap(value: unknown) {
  return normalizeManifestObjectMap<RemoteRecordMeta>(value, '远端 Storage v2 records manifest', (id, entry) => {
    if (
      !isPlainRecord(entry) ||
      typeof entry.entityType !== 'string' ||
      !entry.entityType ||
      !Array.isArray(entry.idValues) ||
      entry.idValues.some((idValue) => typeof idValue !== 'string') ||
      typeof entry.valueHash !== 'string' ||
      !entry.valueHash ||
      typeof entry.path !== 'string' ||
      !entry.path
    ) {
      throw new Error(
        `远端 Storage v2 records manifest 中的记录 ${id} 格式损坏。为避免导入或发布不完整数据，本次同步已停止。`
      )
    }

    const expectedId = recordId(entry.entityType, entry.idValues)
    if (expectedId !== id) {
      throw new Error(
        `远端 Storage v2 records manifest 中的记录 ${id} 与实体 ID 不一致。为避免导入或发布错位数据，本次同步已停止。`
      )
    }

    const version = Number(entry.version ?? 1)
    return {
      entityType: entry.entityType,
      table: typeof entry.table === 'string' && entry.table ? entry.table : entry.entityType,
      idValues: entry.idValues,
      valueHash: entry.valueHash,
      updatedAt: parseTime(entry.updatedAt),
      deletedAt: entry.deletedAt == null ? null : parseTime(entry.deletedAt) || null,
      version: Number.isFinite(version) ? version : 1,
      path: entry.path
    }
  })
}

function normalizeRemoteBlobMetaMap(value: unknown) {
  return normalizeManifestObjectMap<RemoteBlobMeta>(value, '远端 Storage v2 blobs manifest', (id, entry) => {
    if (
      !isPlainRecord(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.checksum !== 'string' ||
      !entry.checksum ||
      typeof entry.storagePath !== 'string' ||
      !entry.storagePath ||
      typeof entry.path !== 'string' ||
      !entry.path
    ) {
      throw new Error(
        `远端 Storage v2 blobs manifest 中的附件 ${id} 格式损坏。为避免导入或发布不完整附件，本次同步已停止。`
      )
    }

    if (entry.id !== id) {
      throw new Error(
        `远端 Storage v2 blobs manifest 中的附件 ${id} 与附件 ID 不一致。为避免导入或发布错位附件，本次同步已停止。`
      )
    }

    const byteSize = Number(entry.byteSize)
    if (!Number.isFinite(byteSize) || byteSize < 0) {
      throw new Error(
        `远端 Storage v2 blobs manifest 中的附件 ${id} 文件大小无效。为避免导入异常附件，本次同步已停止。`
      )
    }

    return {
      id: entry.id,
      checksum: entry.checksum,
      byteSize,
      storagePath: entry.storagePath,
      path: entry.path,
      updatedAt: parseTime(entry.updatedAt)
    }
  })
}

function normalizeRemoteBundleMeta(value: unknown) {
  if (value == null) return null
  if (
    !isPlainRecord(value) ||
    typeof value.path !== 'string' ||
    !value.path ||
    typeof value.valueHash !== 'string' ||
    !value.valueHash
  ) {
    throw new Error('远端 Storage v2 bundle manifest 格式损坏。为避免导入不完整数据，本次同步已停止。')
  }

  return {
    version: 1,
    path: value.path,
    valueHash: value.valueHash,
    recordCount: normalizeRemoteManifestCount(value.recordCount, '远端 Storage v2 bundle manifest 记录'),
    blobCount: normalizeRemoteManifestCount(value.blobCount, '远端 Storage v2 bundle manifest 附件'),
    updatedAt: parseTime(value.updatedAt)
  } satisfies RemoteRecordBundleMeta
}

function normalizeRemoteSecretMeta(value: unknown) {
  if (value == null) return null
  if (
    !isPlainRecord(value) ||
    typeof value.path !== 'string' ||
    !value.path ||
    typeof value.valueHash !== 'string' ||
    !value.valueHash ||
    value.encryption !== SECRET_SYNC_ENCRYPTION
  ) {
    throw new Error('远端 Storage v2 敏感配置 manifest 格式损坏。为避免导入不完整模型密钥，本次同步已停止。')
  }

  return {
    version: 1,
    path: value.path,
    valueHash: value.valueHash,
    secretCount: normalizeRemoteManifestCount(value.secretCount, '远端 Storage v2 敏感配置 manifest'),
    updatedAt: parseTime(value.updatedAt),
    encryption: SECRET_SYNC_ENCRYPTION
  } satisfies RemoteSecretVaultMeta
}

function normalizeManifest(manifest?: StorageV2WebDavRecordSyncManifest | null): StorageV2WebDavRecordSyncManifest {
  return {
    version: 1,
    records: normalizeRemoteRecordMetaMap(manifest?.records),
    blobs: normalizeRemoteBlobMetaMap(manifest?.blobs),
    bundle: normalizeRemoteBundleMeta(manifest?.bundle),
    secrets: normalizeRemoteSecretMeta(manifest?.secrets)
  }
}

function encodePart(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function safeRemoteRelativePath(value: string) {
  const rawPath = String(value ?? '')
  if (!rawPath.trim() || rawPath.includes('\\') || /^[a-z]:/i.test(rawPath)) {
    throw new Error('Remote Storage v2 record path is invalid')
  }
  const normalized = path.posix.normalize(rawPath)
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
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

function jsonByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(canonicalize(value)), 'utf8')
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

function secretBundlePath(valueHash: string) {
  return `${STORAGE_V2_SECRET_VAULT_DIR}/${encodePart(valueHash)}.json`
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
    entityIds: listStorageV2CompositeEntityIdCandidates(idValues),
    idValues
  }
}

function tombstoneTargetFromRow(row: Record<string, unknown>) {
  const entityType = typeof row.entity_type === 'string' ? row.entity_type : null
  const entityId = typeof row.entity_id === 'string' ? row.entity_id : null
  if (!entityType || !entityId || !Object.hasOwn(TOMBSTONE_PHYSICAL_DELETE_TARGETS, entityType)) return null

  const target = TOMBSTONE_PHYSICAL_DELETE_TARGETS[entityType as keyof typeof TOMBSTONE_PHYSICAL_DELETE_TARGETS]
  const idValues = decodeStorageV2CompositeEntityId(entityId, target.idColumns.length)
  if (!idValues) return null

  return {
    entityType,
    idValues
  }
}

function tombstoneTargetFromMeta(meta: RemoteRecordMeta) {
  if (meta.entityType !== TOMBSTONE_ENTITY_TYPE) return null

  const entityType = meta.idValues[0]
  const entityId = meta.idValues[1]
  if (!entityType || !entityId || !Object.hasOwn(TOMBSTONE_PHYSICAL_DELETE_TARGETS, entityType)) return null

  const target = TOMBSTONE_PHYSICAL_DELETE_TARGETS[entityType as keyof typeof TOMBSTONE_PHYSICAL_DELETE_TARGETS]
  const idValues = decodeStorageV2CompositeEntityId(entityId, target.idColumns.length)
  if (!idValues) return null

  return {
    entityType,
    idValues
  }
}

function sameIdValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function bufferFromRemoteContents(value: string | Buffer | ArrayBuffer | unknown) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'string') return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return Buffer.from(String(value))
}

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256String(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function deriveSecretSyncKey(secretKeyMaterial: string | undefined) {
  return createHash('sha256')
    .update(SECRET_SYNC_KEY_CONTEXT)
    .update('\0')
    .update(secretKeyMaterial ?? '')
    .digest()
}

function uniqueSecretKeyMaterials(options: StorageV2WebDavRecordSyncOptions) {
  return [options.secretKeyMaterial, options.legacySecretKeyMaterial].filter(
    (value, index, values): value is string =>
      typeof value === 'string' && values.findIndex((candidate) => candidate === value) === index
  )
}

function secretEntryTimestamp(entry: StorageV2PlaintextSecretVaultEntry | undefined) {
  if (!entry?.updatedAt) return 0
  const parsed = Date.parse(entry.updatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function secretEntryHash(entry: StorageV2PlaintextSecretVaultEntry | undefined) {
  return entry ? sha256String(entry.value) : null
}

function secretVaultValueHash(secrets: Record<string, StorageV2PlaintextSecretVaultEntry>) {
  return hashJson(
    Object.entries(secrets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([secretId, entry]) => [secretId, secretEntryHash(entry), entry.updatedAt])
  )
}

function secretVaultUpdatedAt(secrets: Record<string, StorageV2PlaintextSecretVaultEntry>) {
  return Math.max(0, ...Object.values(secrets).map(secretEntryTimestamp))
}

function deferredLocalRecordHash(valueHash: string) {
  return `deferred-local:${valueHash}`
}

function isDeferredLocalRecordHash(lastHash: string | null | undefined, valueHash: string | null | undefined) {
  return Boolean(valueHash && lastHash === deferredLocalRecordHash(valueHash))
}

function hasLocalRecordChangedSinceSync(lastHash: string | null | undefined, valueHash: string | null | undefined) {
  if (!valueHash) return false
  return valueHash !== lastHash && !isDeferredLocalRecordHash(lastHash, valueHash)
}

function shouldDeferLocalOnlyFirstJoinRecord(record: LocalRecord) {
  return FIRST_JOIN_DEFER_LOCAL_ONLY_ENTITY_TYPES.has(record.table.entityType)
}

function collectFirstJoinRequiredUploadIds(localRecords: readonly LocalRecord[]) {
  const localById = new Map(localRecords.map((record) => [record.id, record]))
  const requiredIds = new Set<string>()

  for (const record of localRecords) {
    if (record.table.entityType !== 'task_run_log') continue

    const taskId = typeof record.row.task_id === 'string' ? record.row.task_id : ''
    if (taskId) {
      const scheduledTaskId = recordId('scheduled_task', [taskId])
      if (localById.has(scheduledTaskId)) requiredIds.add(scheduledTaskId)
    }
  }

  let changed = true
  while (changed) {
    changed = false

    for (const id of Array.from(requiredIds)) {
      const record = localById.get(id)
      if (!record || record.table.entityType !== 'scheduled_task') continue

      const agentId = typeof record.row.agent_id === 'string' ? record.row.agent_id : ''
      if (!agentId) continue

      const requiredAgentId = recordId('agent', [agentId])
      if (!localById.has(requiredAgentId) || requiredIds.has(requiredAgentId)) continue

      requiredIds.add(requiredAgentId)
      changed = true
    }
  }

  return requiredIds
}

function filterSecretsByReferencedIds(
  secrets: Record<string, StorageV2PlaintextSecretVaultEntry>,
  referencedSecretIds: ReadonlySet<string>
) {
  return Object.fromEntries(Object.entries(secrets).filter(([secretId]) => referencedSecretIds.has(secretId)))
}

function formatLimitedList(values: Iterable<string>, limit = 8) {
  const list = Array.from(values).filter(Boolean)
  const visible = list.slice(0, limit)
  const suffix = list.length > visible.length ? ` 等 ${list.length} 项` : ''
  return `${visible.join('、')}${suffix}`
}

function isPlaintextSecretPayload(value: unknown) {
  if (value == null) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return Boolean(trimmed && !trimmed.startsWith(STORAGE_V2_SECRET_REF_PREFIX))
  }
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return false
}

function collectProviderPlaintextSecretPaths(row: Record<string, InValue>) {
  const config = parseJsonCell(row.config_json)
  if (!isPlainRecord(config)) return []

  const paths: string[] = []
  if (isPlaintextSecretPayload(config.apiKey)) {
    paths.push('config_json.apiKey')
  }

  if (Array.isArray(config.apiKeys)) {
    config.apiKeys.forEach((entry, index) => {
      if (isPlainRecord(entry) && isPlaintextSecretPayload(entry.key)) {
        paths.push(`config_json.apiKeys[${index}].key`)
      }
    })
  }

  const authConfig = config.authConfig
  if (isPlainRecord(authConfig)) {
    for (const [key, value] of Object.entries(authConfig)) {
      if (isProviderAuthConfigSecretKey(key) && isPlaintextSecretPayload(value)) {
        paths.push(`config_json.authConfig.${key}`)
      }
    }
  }

  collectProviderPlaintextHeaderPaths(config.settings, 'config_json.settings', paths)
  collectProviderPlaintextHeaderPaths(config.providerSettings, 'config_json.providerSettings', paths)

  return paths
}

function collectProviderPlaintextHeaderPaths(value: unknown, pathPrefix: string, paths: string[]) {
  if (!isPlainRecord(value) || !isPlainRecord(value.extraHeaders)) return

  for (const [headerName, headerValue] of Object.entries(value.extraHeaders)) {
    if (isSensitiveHeaderName(headerName) && isPlaintextSecretPayload(headerValue)) {
      paths.push(`${pathPrefix}.extraHeaders.${headerName}`)
    }
  }
}

function configuredRemoteArtifactCleanupMaxFiles() {
  const parsed = Number(process.env[DATA_SYNC_CLEANUP_MAX_FILES_ENV])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMOTE_ARTIFACT_CLEANUP_MAX_FILES
}

function encryptRemoteSecret(secretId: string, entry: StorageV2PlaintextSecretVaultEntry, key: Buffer) {
  const iv = randomBytes(GCM_IV_BYTE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(secretId, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(entry.value, 'utf8'), cipher.final()])

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    updatedAt: entry.updatedAt
  }
}

function decryptRemoteSecret(secretId: string, entry: RemoteEncryptedSecretEntry, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'))
  decipher.setAAD(Buffer.from(secretId, 'utf8'))
  decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(entry.encrypted, 'base64')), decipher.final()]).toString('utf8')
}

function normalizeLocalStoragePath(input: string) {
  const rawPath = String(input ?? '')
    .split('\u0000')
    .join('')
    .replace(/\\/g, '/')
  if (!rawPath.trim() || /^[a-z]:/i.test(rawPath)) {
    throw new Error('Storage v2 blob path is invalid')
  }

  const normalized = path.posix.normalize(rawPath)
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new Error('Storage v2 blob path is invalid')
  }

  return normalized.split('/').join(path.sep)
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

function isPreconditionCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && error.status === 412
}

export class StorageV2WebDavRecordSyncService {
  private columnsByTable = new Map<string, string[]>()
  private skillIdRemaps = new Map<string, string>()
  private readonly tablesByEntity: ReadonlyMap<string, StorageV2SyncTable>
  private readonly tableWeightsByEntity: ReadonlyMap<string, number>

  constructor(private readonly tables: readonly StorageV2SyncTable[] = STORAGE_V2_SYNC_TABLES) {
    this.tablesByEntity = new Map(tables.map((table) => [table.entityType, table]))
    this.tableWeightsByEntity = new Map(tables.map((table, index) => [table.entityType, index]))
  }

  private tableByEntity(entityType: string) {
    return this.tablesByEntity.get(entityType) ?? null
  }

  private tableWeight(entityType: string) {
    return this.tableWeightsByEntity.get(entityType) ?? Number.MAX_SAFE_INTEGER
  }

  private async ensureDirectory(client: WebDAVClient, dirPath: string, signal?: AbortSignal) {
    if (dirPath === '/') return

    try {
      if (
        await runWebDavOperation(`checking remote directory ${dirPath}`, () => webDavExists(client, dirPath, signal), {
          logger,
          signal
        })
      ) {
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
        () => client.createDirectory(dirPath, withStorageWebDavSignal({ recursive: true }, signal)),
        {
          logger,
          signal
        }
      )
    } catch (error) {
      if (isIgnorableCreateDirectoryError(error)) {
        logger.warn(`Remote directory ${dirPath} already exists or was created concurrently`, error as Error)
        return
      }
      if (isPreconditionCreateDirectoryError(error)) {
        const existsAfterFailure = await runWebDavOperation(
          `checking remote directory ${dirPath} after create precondition failure`,
          () => webDavExists(client, dirPath, signal),
          { logger, signal }
        ).catch(() => false)
        if (existsAfterFailure) {
          logger.warn(`Remote directory ${dirPath} exists after create precondition failure`, error as Error)
          return
        }
      }
      throw error
    }
  }

  private async assertWriteAccess(client: WebDAVClient, basePath: string, signal?: AbortSignal) {
    const probePath = path.posix.join(basePath, `.cherry-studio-pi-storage-write-test-${Date.now()}.tmp`)
    await runWebDavOperation(
      `writing Storage v2 sync probe ${probePath}`,
      () => client.putFileContents(probePath, 'ok', withStorageWebDavSignal({ overwrite: true }, signal)),
      { logger, signal }
    )

    const maybeDeleteFile = (
      client as WebDAVClient & { deleteFile?: (filePath: string, options?: { signal?: AbortSignal }) => Promise<void> }
    ).deleteFile
    if (typeof maybeDeleteFile !== 'function') {
      throw new Error(
        '当前 WebDAV 客户端不支持删除远端文件，无法保证 Storage v2 同步目录文件数量收敛。请更换 WebDAV 服务或升级客户端后重试。'
      )
    }

    await runWebDavOperation(
      `deleting Storage v2 sync probe ${probePath}`,
      () => (signal ? maybeDeleteFile.call(client, probePath, { signal }) : maybeDeleteFile.call(client, probePath)),
      { logger, signal }
    )
  }

  private async getRemoteFileByteSize(
    client: WebDAVClient,
    filePath: string,
    signal?: AbortSignal
  ): Promise<number | null> {
    const stat = (
      client as WebDAVClient & {
        stat?: (targetPath: string, options?: { signal?: AbortSignal }) => Promise<unknown>
      }
    ).stat
    if (typeof stat !== 'function') return null

    try {
      const result = await runWebDavOperation(
        `checking remote file size ${filePath}`,
        () => (signal ? stat.call(client, filePath, { signal }) : stat.call(client, filePath)),
        {
          logger,
          signal
        }
      )
      const size = Number((result as { size?: unknown } | null)?.size)
      return Number.isFinite(size) && size >= 0 ? size : null
    } catch (error) {
      if (error instanceof WebDavOperationError && error.transient) throw error
      logger.warn(`Failed to check remote file size ${filePath}; falling back to bounded download`, error as Error)
      return null
    }
  }

  private async assertRemoteFileWithinByteLimit(
    client: WebDAVClient,
    filePath: string,
    label: string,
    maxBytes: number,
    signal?: AbortSignal
  ) {
    const byteSize = await this.getRemoteFileByteSize(client, filePath, signal)
    if (byteSize == null || byteSize <= maxBytes) return

    throw new RemoteSyncSizeLimitError(
      `${label}过大（${byteSize} 字节，限制 ${maxBytes} 字节）。为避免长时间下载或占用过多内存，本次同步已停止。`
    )
  }

  private assertRemoteBufferWithinByteLimit(buffer: Buffer, label: string, maxBytes: number) {
    if (buffer.byteLength <= maxBytes) return

    throw new RemoteSyncSizeLimitError(
      `${label}过大（${buffer.byteLength} 字节，限制 ${maxBytes} 字节）。为避免长时间解析或占用过多内存，本次同步已停止。`
    )
  }

  private async readJson<T>(
    client: WebDAVClient,
    filePath: string,
    options: { maxBytes?: number; label?: string; signal?: AbortSignal } = {}
  ): Promise<T | null> {
    try {
      if (
        !(await runWebDavOperation(
          `checking Storage v2 sync record ${filePath}`,
          () => webDavExists(client, filePath, options.signal),
          {
            logger,
            signal: options.signal
          }
        ))
      ) {
        return null
      }
      const label = options.label ?? '远端 Storage v2 JSON'
      if (options.maxBytes) {
        await this.assertRemoteFileWithinByteLimit(client, filePath, label, options.maxBytes, options.signal)
      }
      const contents = await runWebDavOperation(
        `reading Storage v2 sync record ${filePath}`,
        () => client.getFileContents(filePath, withStorageWebDavSignal({ format: 'binary' as const }, options.signal)),
        { logger, signal: options.signal }
      )
      const buffer = bufferFromRemoteContents(contents)
      if (options.maxBytes) {
        this.assertRemoteBufferWithinByteLimit(buffer, label, options.maxBytes)
      }
      return JSON.parse(buffer.toString('utf8')) as T
    } catch (error) {
      if (error instanceof RemoteSyncSizeLimitError) {
        throw error
      }
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
    bundledRecord?: LocalRecord | null,
    signal?: AbortSignal
  ) {
    if (isBundleRecordPath(meta.path)) {
      return Boolean(bundledRecord)
    }

    const relativePath = safeRemoteRelativePath(meta.path)
    const remotePath = path.posix.join(basePath, relativePath)
    try {
      return await runWebDavOperation(
        `checking Storage v2 sync record existence ${remotePath}`,
        () => webDavExists(client, remotePath, signal),
        { logger, signal }
      )
    } catch (error) {
      if (error instanceof WebDavOperationError && error.status === 404) return false
      throw error
    }
  }

  private async writeJson(
    client: WebDAVClient,
    filePath: string,
    data: unknown,
    options: { overwrite?: boolean; signal?: AbortSignal } = {}
  ) {
    await this.ensureDirectory(client, path.posix.dirname(filePath), options.signal)
    await writeWebDavJsonAtomically(client, filePath, data, {
      logger,
      operation: 'Storage v2 sync record',
      overwrite: options.overwrite,
      signal: options.signal
    })
  }

  private assertRemoteArtifactCleanupFileBudget(counter: { files: number }, rootPath: string) {
    const maxFiles = configuredRemoteArtifactCleanupMaxFiles()
    if (counter.files <= maxFiles) return

    throw new Error(
      `远端 Storage v2 同步旧文件数量过多（${rootPath} 已超过 ${maxFiles} 个）。为避免 WebDAV 清理阶段长时间卡住，本次同步已停止；请清理远端目录中的异常旧文件后重试。`
    )
  }

  private async listRemoteFilesRecursive(
    client: WebDAVClient,
    dirPath: string,
    options: { assertActive?: () => void; counter?: { files: number }; rootPath?: string; signal?: AbortSignal } = {}
  ): Promise<string[]> {
    options.assertActive?.()
    try {
      const exists = await runWebDavOperation(
        `checking Storage v2 artifact directory ${dirPath}`,
        () => webDavExists(client, dirPath, options.signal),
        { logger, signal: options.signal }
      )
      if (!exists) return []
    } catch (error) {
      if (error instanceof WebDavOperationError && error.status === 404) return []
      throw error
    }

    const contents = await runWebDavOperation(
      `listing Storage v2 artifact directory ${dirPath}`,
      () => webDavGetDirectoryContents(client, dirPath, options.signal),
      { logger, signal: options.signal }
    ).catch((error) => {
      if (error instanceof WebDavOperationError && error.status === 404) return []
      throw error
    })
    const entries = Array.isArray(contents)
      ? contents
      : Array.isArray((contents as { data?: unknown } | null)?.data)
        ? ((contents as { data: unknown[] }).data as Array<{ filename?: string; basename?: string; type?: string }>)
        : []
    const files: string[] = []
    const normalizedDirPath = path.posix.normalize(dirPath).replace(/\/+$/g, '')
    const counter = options.counter ?? { files: 0 }
    const rootPath = options.rootPath ?? normalizedDirPath

    for (const entry of entries as Array<{ filename?: string; basename?: string; type?: string }>) {
      options.assertActive?.()
      const filename = remoteDirectoryEntryPath(entry, dirPath)
      if (!filename || filename === dirPath) continue
      const normalizedFilename = path.posix.normalize(filename)
      if (normalizedFilename === normalizedDirPath) continue
      if (normalizedFilename !== normalizedDirPath && !normalizedFilename.startsWith(`${normalizedDirPath}/`)) continue
      if (entry.type === 'directory') {
        files.push(
          ...(await this.listRemoteFilesRecursive(client, normalizedFilename, {
            assertActive: options.assertActive,
            counter,
            rootPath,
            signal: options.signal
          }))
        )
      } else {
        counter.files += 1
        this.assertRemoteArtifactCleanupFileBudget(counter, rootPath)
        files.push(normalizedFilename)
      }
    }

    return files
  }

  private async deleteRemoteFileIfPossible(client: WebDAVClient, filePath: string, signal?: AbortSignal) {
    const deleteFile = (
      client as WebDAVClient & {
        deleteFile?: (targetPath: string, options?: { signal?: AbortSignal }) => Promise<void>
      }
    ).deleteFile
    if (typeof deleteFile !== 'function') {
      throw new Error(
        '当前 WebDAV 客户端不支持删除远端文件，无法清理旧 Storage v2 同步文件。请更换 WebDAV 服务或升级客户端后重试。'
      )
    }

    await runWebDavOperation(
      `deleting stale Storage v2 artifact ${filePath}`,
      () => (signal ? deleteFile.call(client, filePath, { signal }) : deleteFile.call(client, filePath)),
      {
        logger,
        signal
      }
    ).catch((error) => {
      if (error instanceof WebDavOperationError && error.status === 404) return
      throw error
    })
  }

  private isRemotePathUnderRoot(filePath: string, rootPath: string) {
    const normalizedRoot = path.posix.normalize(rootPath).replace(/\/+$/g, '')
    const normalizedFilePath = path.posix.normalize(filePath)
    return normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(`${normalizedRoot}/`)
  }

  private hasReferencedPathUnderRoot(referenced: ReadonlySet<string>, rootPath: string) {
    for (const filePath of referenced) {
      if (this.isRemotePathUnderRoot(filePath, rootPath)) return true
    }

    return false
  }

  private async pruneRemoteArtifactRootIfUnreferenced(
    client: WebDAVClient,
    rootPath: string,
    referenced: ReadonlySet<string>,
    signal?: AbortSignal
  ) {
    if (this.hasReferencedPathUnderRoot(referenced, rootPath)) return false

    try {
      await this.deleteRemoteFileIfPossible(client, rootPath, signal)
      return true
    } catch (error) {
      if (error instanceof WebDavOperationError && error.transient) {
        throw error
      }

      logger.warn(
        `Failed to prune stale Storage v2 artifact directory ${rootPath}; falling back to file cleanup`,
        error as Error
      )
      return false
    }
  }

  async pruneRemoteArtifacts(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest | null | undefined,
    options: { assertActive?: () => void; signal?: AbortSignal } = {}
  ) {
    if (!manifest) return

    const referenced = new Set<string>()
    const addReferencedPath = (relativePath: string | null | undefined) => {
      if (!relativePath) return
      referenced.add(path.posix.join(basePath, safeRemoteRelativePath(relativePath)))
    }

    addReferencedPath(manifest.bundle?.path)
    addReferencedPath(manifest.secrets?.path)
    for (const meta of Object.values(manifest.records ?? {})) {
      addReferencedPath(meta.path)
    }
    for (const blob of Object.values(manifest.blobs ?? {})) {
      addReferencedPath(blob.path)
    }

    const roots = ['storage-v2/records', STORAGE_V2_BUNDLE_DIR, 'storage-v2/blobs', STORAGE_V2_SECRET_VAULT_DIR]
    for (const root of roots) {
      options.assertActive?.()
      const rootPath = path.posix.join(basePath, root)
      if (await this.pruneRemoteArtifactRootIfUnreferenced(client, rootPath, referenced, options.signal)) {
        continue
      }

      const files = await this.listRemoteFilesRecursive(client, rootPath, {
        assertActive: options.assertActive,
        signal: options.signal
      })
      for (const filePath of files) {
        options.assertActive?.()
        if (referenced.has(filePath)) continue
        await this.deleteRemoteFileIfPossible(client, filePath, options.signal)
      }
    }
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

  private assertRemoteManifestEntitiesSupported(manifest: StorageV2WebDavRecordSyncManifest) {
    const unsupportedEntityTypes = new Set<string>()

    for (const meta of Object.values(manifest.records ?? {})) {
      if (!meta?.entityType || this.tableByEntity(meta.entityType)) continue
      unsupportedEntityTypes.add(meta.entityType)
    }

    if (unsupportedEntityTypes.size === 0) return

    throw new Error(
      `远端 Storage v2 同步数据包含当前版本不支持的实体：${formatLimitedList(
        unsupportedEntityTypes
      )}。请先升级 Cherry Studio Pi 后再同步，避免旧版本覆盖或删除新版本数据。`
    )
  }

  private async readRecordBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    signal?: AbortSignal
  ): Promise<StorageV2WebDavRecordSyncBundle | null> {
    if (!manifest.bundle?.path) return null

    const bundle = await this.readJson<StorageV2WebDavRecordSyncBundle>(
      client,
      path.posix.join(basePath, safeRemoteRelativePath(manifest.bundle.path)),
      {
        maxBytes: MAX_SYNC_RECORD_BUNDLE_REMOTE_JSON_BYTES,
        label: '远端 Storage v2 记录包',
        signal
      }
    )
    if (!isPlainRecord(bundle?.records)) {
      throw new Error(
        '远端 Storage v2 数据包缺失或格式损坏。为避免把损坏状态当作成功同步，本次同步已停止，请重新同步或从安全快照恢复。'
      )
    }
    const rawBundleBlobs = bundle.blobs ?? {}
    if (!isPlainRecord(rawBundleBlobs)) {
      throw new Error(
        '远端 Storage v2 数据包 blobs 格式损坏。为避免导入不完整附件，本次同步已停止，请重新同步或从安全快照恢复。'
      )
    }

    const valueHash = bundleHash({
      records: bundle.records,
      blobs: rawBundleBlobs
    })
    if (manifest.bundle.valueHash && manifest.bundle.valueHash !== valueHash) {
      throw new Error(
        '远端 Storage v2 数据包校验失败。为避免覆盖或导入损坏数据，本次同步已停止，请重新同步或从安全快照恢复。'
      )
    }

    const unsupportedEntityTypes = new Set<string>()
    const malformedRecordIds: string[] = []
    const records = Object.entries(bundle.records).reduce<Record<string, LocalRecord>>((result, [id, record]) => {
      const entityType = typeof record?.table?.entityType === 'string' ? record.table.entityType : null
      if (entityType && !this.tableByEntity(entityType)) {
        unsupportedEntityTypes.add(entityType)
        return result
      }

      const normalized = this.normalizeBundledRecord(id, record)
      if (normalized) {
        result[id] = normalized
      } else {
        malformedRecordIds.push(id)
      }
      return result
    }, {})

    if (unsupportedEntityTypes.size > 0) {
      throw new Error(
        `远端 Storage v2 数据包包含当前版本不支持的实体：${formatLimitedList(
          unsupportedEntityTypes
        )}。请先升级 Cherry Studio Pi 后再同步，避免旧版本覆盖或删除新版本数据。`
      )
    }

    if (malformedRecordIds.length > 0) {
      throw new Error(
        `远端 Storage v2 数据包包含无法识别或损坏的记录：${formatLimitedList(
          malformedRecordIds
        )}。为避免导入不完整数据，本次同步已停止，请重新同步或从安全快照恢复。`
      )
    }
    const normalizedBlobs = normalizeRemoteBlobMetaMap(rawBundleBlobs)
    const actualRecordCount = Object.keys(records).length
    const actualBlobCount = Object.keys(normalizedBlobs).length
    if (manifest.bundle.recordCount !== actualRecordCount || manifest.bundle.blobCount !== actualBlobCount) {
      throw new Error(
        `远端 Storage v2 数据包数量与 manifest 不一致（记录 ${actualRecordCount}/${manifest.bundle.recordCount}，附件 ${actualBlobCount}/${manifest.bundle.blobCount}）。为避免导入不完整数据，本次同步已停止，请重新同步或从安全快照恢复。`
      )
    }

    const normalizedBundle: StorageV2WebDavRecordSyncBundle = {
      version: 1,
      updatedAt: parseTime(bundle.updatedAt) || Date.now(),
      records,
      blobs: normalizedBlobs
    }
    const normalizedBundleByteSize = jsonByteLength(normalizedBundle)
    if (normalizedBundleByteSize > MAX_SYNC_RECORD_BUNDLE_JSON_BYTES) {
      throw new Error(
        `远端 Storage v2 记录包过大（${normalizedBundleByteSize} 字节，限制 ${MAX_SYNC_RECORD_BUNDLE_JSON_BYTES} 字节）。为避免导入异常大的同步状态，本次同步已停止。`
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

  private assertRecordRowWithinSyncBudget(entityType: string, row: Record<string, InValue>) {
    const byteSize = jsonByteLength(row)
    if (byteSize <= MAX_SYNC_RECORD_JSON_BYTES) return

    throw new Error(
      `同步数据失败：${entityType} 记录过大（${byteSize} 字节，限制 ${MAX_SYNC_RECORD_JSON_BYTES} 字节）。` +
        '这通常是任务日志、工具输出或消息块保存了过大的原始内容。请清理对应记录后重试。'
    )
  }

  private async writeRecordBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    recordsById: Map<string, LocalRecord>,
    options: { verifiedRemoteBundle?: { path: string; valueHash: string } | null; signal?: AbortSignal } = {}
  ) {
    const bundle = this.buildBundle(recordsById, manifest.blobs)
    const bundleByteSize = jsonByteLength(bundle)
    if (bundleByteSize > MAX_SYNC_RECORD_BUNDLE_JSON_BYTES) {
      throw new Error(
        `同步数据失败：Storage v2 记录包过大（${bundleByteSize} 字节，限制 ${MAX_SYNC_RECORD_BUNDLE_JSON_BYTES} 字节）。` +
          '请先清理任务运行日志、超长消息或大附件，再重新同步。'
      )
    }

    const valueHash = bundleHash(bundle)
    const relativePath = recordBundlePath(valueHash)
    const remoteBundleAlreadyVerified =
      options.verifiedRemoteBundle?.path === relativePath && options.verifiedRemoteBundle.valueHash === valueHash
    if (!remoteBundleAlreadyVerified) {
      await this.writeJson(client, path.posix.join(basePath, relativePath), bundle, {
        overwrite: false,
        signal: options.signal
      })
    }

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
    const referencedBlobIds = await this.getReferencedBlobIds(client)

    for (const table of this.tables) {
      const result = await client.execute(`SELECT * FROM ${table.table}`)
      for (const sourceRow of result.rows) {
        const source = rowToPlain(sourceRow as Record<string, unknown>)
        const idValues = (table.syncIdColumns ?? table.idColumns).map((column) => String(source[column] ?? ''))
        if (idValues.some((value) => !value)) continue
        const row = { ...source }
        for (const column of table.omitColumnsFromSync ?? []) {
          delete row[column]
        }
        if (table.entityType === 'blob' && !referencedBlobIds.has(idValues[0])) continue

        const deletedAt = table.deletedAtColumn ? parseTime(row[table.deletedAtColumn]) || null : null
        const updatedAt = table.updatedAtColumn ? parseTime(row[table.updatedAtColumn]) : 0
        const version = table.versionColumn ? Number(row[table.versionColumn] ?? 1) : 1

        const plaintextProviderSecretPaths =
          table.entityType === 'provider' ? collectProviderPlaintextSecretPaths(row) : []
        if (plaintextProviderSecretPaths.length > 0) {
          throw new Error(
            `同步数据失败：服务商 ${idValues[0]} 的 Storage v2 配置仍包含明文敏感字段：${formatLimitedList(
              plaintextProviderSecretPaths
            )}。请重新保存这个服务商配置，让密钥进入本地安全密钥库后再同步。`
          )
        }
        this.assertRecordRowWithinSyncBudget(table.entityType, row)
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

  private async getReferencedBlobIds(client: Client) {
    const blobIds = new Set<string>()
    const queries = [
      'SELECT blob_id AS id FROM files WHERE blob_id IS NOT NULL AND deleted_at IS NULL',
      'SELECT blob_id AS id FROM message_blocks WHERE blob_id IS NOT NULL AND deleted_at IS NULL',
      'SELECT avatar_blob_id AS id FROM profiles WHERE avatar_blob_id IS NOT NULL',
      'SELECT avatar_blob_id AS id FROM assistants WHERE avatar_blob_id IS NOT NULL AND deleted_at IS NULL',
      'SELECT avatar_blob_id AS id FROM agents WHERE avatar_blob_id IS NOT NULL AND deleted_at IS NULL'
    ]

    for (const sql of queries) {
      try {
        const result = await client.execute(sql)
        for (const row of result.rows) {
          const id = row.id
          if (typeof id === 'string' && id) blobIds.add(id)
        }
      } catch (error) {
        logger.warn('Failed to inspect Storage v2 blob references before sync', error as Error)
      }
    }

    return blobIds
  }

  private async readRemoteSecretVaultBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    options: StorageV2WebDavRecordSyncOptions
  ): Promise<Record<string, StorageV2PlaintextSecretVaultEntry> | null> {
    if (!manifest.secrets?.path) return null
    if (manifest.secrets.encryption !== SECRET_SYNC_ENCRYPTION) {
      throw new Error('远端敏感配置使用了当前版本不支持的加密格式。为避免模型配置残缺，本次同步已停止。')
    }
    if (manifest.secrets.secretCount > MAX_SYNC_SECRET_COUNT) {
      throw new Error(
        `远端敏感配置数量过多（${manifest.secrets.secretCount} 项，限制 ${MAX_SYNC_SECRET_COUNT} 项）。为避免导入异常同步状态，本次同步已停止。`
      )
    }

    const bundle = await this.readJson<RemoteSecretVaultBundle>(
      client,
      path.posix.join(basePath, safeRemoteRelativePath(manifest.secrets.path)),
      {
        maxBytes: MAX_SYNC_SECRET_BUNDLE_JSON_BYTES,
        label: '远端敏感配置数据包',
        signal: options.signal
      }
    )
    if (!bundle?.secrets || typeof bundle.secrets !== 'object') {
      throw new Error('远端敏感配置数据包缺失或格式损坏。为避免模型配置残缺，本次同步已停止。')
    }
    if (Object.keys(bundle.secrets).length > MAX_SYNC_SECRET_COUNT) {
      throw new Error(
        `远端敏感配置数量过多（${Object.keys(bundle.secrets).length} 项，限制 ${MAX_SYNC_SECRET_COUNT} 项）。为避免导入异常同步状态，本次同步已停止。`
      )
    }
    const actualSecretCount = Object.keys(bundle.secrets).length
    if (manifest.secrets.secretCount !== actualSecretCount) {
      throw new Error(
        `远端敏感配置数量与 manifest 不一致（${actualSecretCount}/${manifest.secrets.secretCount}）。为避免导入不完整模型密钥，本次同步已停止。`
      )
    }

    const keyMaterials = uniqueSecretKeyMaterials(options)
    if (keyMaterials.length === 0) keyMaterials.push('')
    const secrets: Record<string, StorageV2PlaintextSecretVaultEntry> = {}
    let lastDecryptError: unknown = null
    try {
      for (const keyMaterial of keyMaterials) {
        const candidateSecrets: Record<string, StorageV2PlaintextSecretVaultEntry> = {}
        const key = deriveSecretSyncKey(keyMaterial)
        try {
          for (const [secretId, entry] of Object.entries(bundle.secrets)) {
            if (!entry?.encrypted || !entry.iv || !entry.authTag || !entry.updatedAt) continue
            candidateSecrets[secretId] = {
              value: decryptRemoteSecret(secretId, entry, key),
              updatedAt: entry.updatedAt
            }
          }
          Object.assign(secrets, candidateSecrets)
          lastDecryptError = null
          break
        } catch (error) {
          lastDecryptError = error
        }
      }

      if (lastDecryptError) throw lastDecryptError
    } catch (error) {
      throw new Error(
        '远端敏感配置无法解密。请确认这个目录来自同一个 Cherry Studio Pi 同步空间；如果这是旧版本创建的同步目录，请先用原来能同步密钥的设备成功同步一次完成升级。',
        { cause: error }
      )
    }

    const valueHash = secretVaultValueHash(secrets)
    if (manifest.secrets.valueHash && manifest.secrets.valueHash !== valueHash) {
      throw new Error('远端敏感配置校验失败。为避免导入损坏的模型密钥，本次同步已停止。')
    }

    return secrets
  }

  private async writeRemoteSecretVaultBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    secrets: Record<string, StorageV2PlaintextSecretVaultEntry>,
    secretKeyMaterial: string | undefined,
    signal?: AbortSignal
  ) {
    const valueHash = secretVaultValueHash(secrets)
    const relativePath = secretBundlePath(valueHash)
    const key = deriveSecretSyncKey(secretKeyMaterial)
    const bundle: RemoteSecretVaultBundle = {
      version: 1,
      updatedAt: secretVaultUpdatedAt(secrets),
      secrets: Object.fromEntries(
        Object.entries(secrets)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([secretId, entry]) => [secretId, encryptRemoteSecret(secretId, entry, key)])
      )
    }
    const secretCount = Object.keys(bundle.secrets).length
    if (secretCount > MAX_SYNC_SECRET_COUNT) {
      throw new Error(
        `同步数据失败：敏感配置数量过多（${secretCount} 项，限制 ${MAX_SYNC_SECRET_COUNT} 项）。请清理不再使用的模型服务配置后重试。`
      )
    }
    const bundleByteSize = jsonByteLength(bundle)
    if (bundleByteSize > MAX_SYNC_SECRET_BUNDLE_JSON_BYTES) {
      throw new Error(
        `同步数据失败：敏感配置数据包过大（${bundleByteSize} 字节，限制 ${MAX_SYNC_SECRET_BUNDLE_JSON_BYTES} 字节）。请清理异常大的密钥或服务配置后重试。`
      )
    }

    await this.writeJson(client, path.posix.join(basePath, relativePath), bundle, {
      overwrite: true,
      signal
    })
    manifest.secrets = {
      version: 1,
      path: relativePath,
      valueHash,
      secretCount: Object.keys(secrets).length,
      updatedAt: bundle.updatedAt,
      encryption: SECRET_SYNC_ENCRYPTION
    }
  }

  private collectRecordSecretRefs(record: LocalRecord) {
    const refs = new Set<string>()
    const invalidRefs = new Set<string>()
    for (const value of Object.values(record.row)) {
      collectStorageV2SecretRefsFromValue(value, refs, invalidRefs)
    }

    return { refs, invalidRefs }
  }

  private collectBundledRecordSecretRefs(records: Iterable<LocalRecord>) {
    const refs = new Set<string>()
    const invalidRefs = new Set<string>()

    for (const record of records) {
      const recordRefs = this.collectRecordSecretRefs(record)
      for (const ref of recordRefs.refs) refs.add(ref)
      for (const ref of recordRefs.invalidRefs) invalidRefs.add(ref)
    }

    return { refs, invalidRefs }
  }

  private async assertRemoteSecretsAvailableForRecord(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    remoteRecord: LocalRecord,
    options: StorageV2WebDavRecordSyncOptions,
    cache: RemoteSecretVaultCache,
    summary: StorageV2WebDavRecordSyncSummary
  ) {
    const { refs, invalidRefs } = this.collectRecordSecretRefs(remoteRecord)
    if (invalidRefs.size > 0) {
      throw new Error(
        `远端 Storage v2 记录 ${remoteRecord.id} 包含无法识别的敏感配置引用：${[...invalidRefs].join(
          ', '
        )}。为避免写入不可用的模型配置，本次同步已停止。`
      )
    }
    if (refs.size === 0) return

    if (!cache.loaded) {
      cache.secrets = await this.readRemoteSecretVaultBundle(client, basePath, manifest, options)
      cache.loaded = true
    }

    if (!cache.secrets) {
      throw new Error(
        `远端 Storage v2 记录 ${remoteRecord.id} 引用了敏感配置，但 WebDAV 上缺少敏感配置数据包。为避免写入缺少密钥的模型配置，本次同步已停止。`
      )
    }

    const missingSecretIds = [...refs].filter((secretId) => !cache.secrets?.[secretId])
    if (missingSecretIds.length > 0) {
      throw new Error(
        `远端 Storage v2 记录 ${remoteRecord.id} 引用了缺失的敏感配置：${missingSecretIds.join(
          ', '
        )}。为避免写入缺少密钥的模型配置，本次同步已停止。`
      )
    }

    const secretsToImport = Object.fromEntries(
      [...refs]
        .filter((secretId) => !cache.importedSecretIds.has(secretId))
        .map((secretId) => [secretId, cache.secrets![secretId]])
    )
    if (Object.keys(secretsToImport).length === 0) return

    try {
      await storageV2SecretVaultService.importPlaintextSecrets(secretsToImport)
    } catch (error) {
      throw new Error(
        `远端 Storage v2 记录 ${remoteRecord.id} 引用的敏感配置无法写入本机。为避免写入缺少密钥的模型配置，本次同步已停止：${errorMessage(
          error
        )}`,
        { cause: error }
      )
    }

    for (const secretId of Object.keys(secretsToImport)) {
      cache.importedSecretIds.add(secretId)
    }
    summary.secretDownloaded += Object.keys(secretsToImport).length
  }

  private async syncSecretVault(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    summary: StorageV2WebDavRecordSyncSummary,
    options: StorageV2WebDavRecordSyncOptions,
    referencedSecretIds: ReadonlySet<string>,
    preImportedSecretIds: ReadonlySet<string> = new Set()
  ) {
    if (referencedSecretIds.size === 0) {
      manifest.secrets = null
      return
    }

    const [localSecretsAll, remoteSecretsAll] = await Promise.all([
      storageV2SecretVaultService.exportPlaintextSecrets(),
      this.readRemoteSecretVaultBundle(client, basePath, manifest, options)
    ])
    const localSecrets = filterSecretsByReferencedIds(localSecretsAll, referencedSecretIds)
    const remoteSecrets = remoteSecretsAll ? filterSecretsByReferencedIds(remoteSecretsAll, referencedSecretIds) : null

    const localIds = Object.keys(localSecrets)
    const remoteIds = Object.keys(remoteSecrets ?? {})
    const availableSecretIds = new Set([...localIds, ...remoteIds])
    const missingSecretIds = [...referencedSecretIds].filter((secretId) => !availableSecretIds.has(secretId))
    if (missingSecretIds.length > 0) {
      throw new Error(
        `Storage v2 记录引用了本机和远端都不存在的敏感配置：${formatLimitedList(
          missingSecretIds
        )}。请重新保存对应模型、服务或设置后再同步，避免发布缺少密钥的配置。`
      )
    }

    if (localIds.length === 0 && remoteIds.length === 0) {
      manifest.secrets = null
      return
    }

    if (!remoteSecrets) {
      await this.writeRemoteSecretVaultBundle(
        client,
        basePath,
        manifest,
        localSecrets,
        options.secretKeyMaterial,
        options.signal
      )
      summary.secretUploaded += localIds.length
      return
    }

    const merged: Record<string, StorageV2PlaintextSecretVaultEntry> = { ...remoteSecrets }
    const remoteImports: Record<string, StorageV2PlaintextSecretVaultEntry> = {}
    const allSecretIds = new Set([...localIds, ...remoteIds])
    let remoteNeedsUpdate =
      Boolean(options.secretKeyMaterial) &&
      Boolean(options.legacySecretKeyMaterial) &&
      options.secretKeyMaterial !== options.legacySecretKeyMaterial

    for (const secretId of allSecretIds) {
      const local = localSecrets[secretId]
      const remote = remoteSecrets[secretId]

      if (local && !remote) {
        merged[secretId] = local
        summary.secretUploaded += 1
        remoteNeedsUpdate = true
        continue
      }

      if (!local && remote) {
        if (!preImportedSecretIds.has(secretId)) {
          remoteImports[secretId] = remote
          summary.secretDownloaded += 1
        }
        continue
      }

      if (!local || !remote) continue

      const localUpdatedAt = secretEntryTimestamp(local)
      const remoteUpdatedAt = secretEntryTimestamp(remote)
      const localHash = secretEntryHash(local)
      const remoteHash = secretEntryHash(remote)

      if (localHash === remoteHash) {
        merged[secretId] = localUpdatedAt >= remoteUpdatedAt ? local : remote
        continue
      }

      if (localUpdatedAt >= remoteUpdatedAt) {
        merged[secretId] = local
        summary.secretUploaded += 1
        remoteNeedsUpdate = true
      } else {
        merged[secretId] = remote
        if (!preImportedSecretIds.has(secretId)) {
          remoteImports[secretId] = remote
          summary.secretDownloaded += 1
        }
      }
    }

    if (Object.keys(remoteImports).length > 0) {
      await storageV2SecretVaultService.importPlaintextSecrets(remoteImports)
    }

    const mergedHash = secretVaultValueHash(merged)
    if (remoteNeedsUpdate || mergedHash !== manifest.secrets?.valueHash) {
      await this.writeRemoteSecretVaultBundle(
        client,
        basePath,
        manifest,
        merged,
        options.secretKeyMaterial,
        options.signal
      )
    }
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

  async commitRecordSyncStates(states: readonly StorageV2WebDavRecordSyncStateCommit[]) {
    if (states.length === 0) return

    const client = await storageV2Database.getClient()
    for (const state of states) {
      if (!state.id || !state.valueHash) continue
      await this.setRecordSyncState(client, state.id, state.valueHash)
    }
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
    const conflictId = `webdav-storage-record:${input.localRecord.id}:${hashJson({
      baseHash: input.baseHash ?? null,
      localHash: input.localRecord.valueHash,
      remoteHash: input.remoteRecord.valueHash
    }).slice(0, 32)}`
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
        conflictId,
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
    bundledRecords?: Map<string, LocalRecord>,
    signal?: AbortSignal
  ) {
    if (bundledRecords) {
      bundledRecords.set(record.id, record)
      manifest.records[record.id] = recordMetaFromLocalRecord(record, recordBundlePath())
      return
    }

    const relativePath = recordPath(record)
    await this.writeJson(client, path.posix.join(basePath, relativePath), record, { signal })

    manifest.records[record.id] = recordMetaFromLocalRecord(record, relativePath)
  }

  private async pullRecord(
    client: WebDAVClient,
    basePath: string,
    meta: RemoteRecordMeta,
    bundledRecord?: LocalRecord | null,
    signal?: AbortSignal
  ) {
    if (!bundledRecord && isBundleRecordPath(meta.path)) {
      throw new Error(
        `远端 Storage v2 数据包中缺少记录 ${meta.entityType}:${meta.idValues.join(':')}。为避免误判同步成功，本次同步已停止。`
      )
    }

    const record =
      bundledRecord ??
      (await this.readJson<LocalRecord>(client, path.posix.join(basePath, safeRemoteRelativePath(meta.path)), {
        maxBytes: MAX_SYNC_RECORD_REMOTE_JSON_BYTES,
        label: `远端 Storage v2 记录 ${meta.entityType}:${meta.idValues.join(':')}`,
        signal
      }))
    if (!record?.row || !record?.table) {
      throw new Error(
        `远端 Storage v2 记录 ${meta.entityType}:${meta.idValues.join(':')} 缺失或格式损坏。为避免导入不完整数据，本次同步已停止。`
      )
    }
    const table = this.tableByEntity(meta.entityType)
    if (!table) return null

    const valueHash = hashJson(record.row)
    if (valueHash !== meta.valueHash) {
      throw new Error(
        `远端 Storage v2 记录 ${meta.entityType}:${meta.idValues.join(':')} 校验失败。为避免导入损坏数据，本次同步已停止。`
      )
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

  private shouldLocalRecordWin(localRecord: LocalRecord, remoteRecord: LocalRecord) {
    if (localRecord.updatedAt !== remoteRecord.updatedAt) {
      return localRecord.updatedAt > remoteRecord.updatedAt
    }

    if (localRecord.version !== remoteRecord.version) {
      return localRecord.version > remoteRecord.version
    }

    return localRecord.valueHash >= remoteRecord.valueHash
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
    const parts = decodeStorageV2CompositeEntityId(entityId, 2)
    if (!parts) return entityId

    const mappedSkillId = this.skillIdRemaps.get(parts[1])
    return mappedSkillId ? encodeStorageV2CompositeEntityId([parts[0], mappedSkillId]) : entityId
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

  private async applyTaskRunLogRecord(client: Client, table: StorageV2SyncTable, row: Record<string, InValue>) {
    const taskId = typeof row.task_id === 'string' ? row.task_id : ''
    const runAt = typeof row.run_at === 'string' ? row.run_at : ''
    if (!taskId || !runAt) return false

    const columns = await this.getTableColumns(client, table.table)
    const insertColumns = columns.filter(
      (column) => column !== 'id' && Object.hasOwn(row, column) && !(table.omitColumnsFromSync ?? []).includes(column)
    )
    if (insertColumns.length === 0) return false

    const existing = await client.execute({
      sql: 'SELECT id FROM task_run_logs WHERE task_id = ? AND run_at = ? LIMIT 1',
      args: [taskId, runAt]
    })
    const existingId = existing.rows[0]?.id

    if (existingId !== undefined && existingId !== null) {
      const updateColumns = insertColumns.filter((column) => column !== 'task_id' && column !== 'run_at')
      if (updateColumns.length === 0) return true

      await client.execute({
        sql: `
          UPDATE task_run_logs
          SET ${updateColumns.map((column) => `${column} = ?`).join(', ')}
          WHERE id = ?
        `,
        args: [...updateColumns.map((column) => row[column] ?? null), existingId as InValue]
      })
      return true
    }

    await client.execute({
      sql: `
        INSERT INTO task_run_logs (${insertColumns.join(', ')})
        VALUES (${insertColumns.map(() => '?').join(', ')})
      `,
      args: insertColumns.map((column) => row[column] ?? null)
    })
    return true
  }

  private async applyRemoteRecord(client: Client, remote: LocalRecord) {
    const table = this.tableByEntity(remote.table.entityType)
    if (!table) return false

    const row = await this.rewriteRemoteRowForLocalAliases(client, table, remote.row)
    if (table.entityType === 'task_run_log') {
      return this.applyTaskRunLogRecord(client, table, row)
    }

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

  private async applyRemoteRecordOrThrow(client: Client, remote: LocalRecord) {
    try {
      const applied = await this.applyRemoteRecord(client, remote)
      if (applied) return
    } catch (error) {
      throw new Error(
        `远端 Storage v2 记录 ${remote.id} 无法写入本地数据库。为避免把未恢复的数据误判为同步成功，本次同步已停止：${errorMessage(
          error
        )}`,
        { cause: error }
      )
    }

    throw new Error(
      `远端 Storage v2 记录 ${remote.id} 缺少当前版本可写入的必要字段。为避免把未恢复的数据误判为同步成功，本次同步已停止。`
    )
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

  private getLocalTombstoneTargetRecordId(record: LocalRecord) {
    if (record.table.entityType !== TOMBSTONE_ENTITY_TYPE) return null

    const target = tombstoneTargetFromRow(record.row)
    return target ? recordId(target.entityType, target.idValues) : null
  }

  private async deleteLocalTombstoneRecord(client: Client, record: LocalRecord) {
    if (record.table.entityType !== TOMBSTONE_ENTITY_TYPE) return false

    const entityType = typeof record.row.entity_type === 'string' ? record.row.entity_type : ''
    const entityId = typeof record.row.entity_id === 'string' ? record.row.entity_id : ''
    if (!entityType || !entityId) return false

    await client.execute({
      sql: 'DELETE FROM sync_tombstones WHERE entity_type = ? AND entity_id = ?',
      args: [entityType, entityId]
    })
    return true
  }

  private async discardLocalFirstJoinTombstoneIfRemoteHasRecord(
    client: Client,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    bundledRecords?: Map<string, LocalRecord>
  ) {
    const targetId = this.getLocalTombstoneTargetRecordId(record)
    if (!targetId) return false

    const targetMeta = manifest.records[targetId]
    if (!targetMeta || targetMeta.deletedAt) return false

    await this.deleteLocalTombstoneRecord(client, record)
    bundledRecords?.delete(record.id)
    delete manifest.records[record.id]
    logger.warn('Discarded local first-join tombstone because the remote sync space has an active record', {
      tombstoneId: record.id,
      targetId
    })
    return true
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

  private pruneManifestBlobsWithoutRecords(
    manifest: StorageV2WebDavRecordSyncManifest,
    bundledRecords: Map<string, LocalRecord>
  ) {
    const activeBlobIds = new Set<string>()
    for (const record of bundledRecords.values()) {
      if (record.table.entityType === 'blob' && !record.deletedAt && record.idValues[0]) {
        activeBlobIds.add(record.idValues[0])
      }
    }

    for (const blobId of Object.keys(manifest.blobs)) {
      if (!activeBlobIds.has(blobId)) {
        delete manifest.blobs[blobId]
      }
    }
  }

  private async isCoveredByLocalTombstone(client: Client, meta: RemoteRecordMeta) {
    const target = tombstoneTargetFromRecord(meta.entityType, meta.idValues)
    if (!target) return false

    const result = await client.execute({
      sql: `
        SELECT deleted_at
        FROM sync_tombstones
        WHERE entity_type = ? AND entity_id IN (${target.entityIds.map(() => '?').join(', ')})
        ORDER BY deleted_at DESC
        LIMIT 1
      `,
      args: [target.entityType, ...target.entityIds]
    })
    const tombstoneDeletedAt = parseTime(result.rows[0]?.deleted_at)
    return tombstoneDeletedAt > 0 && tombstoneDeletedAt >= meta.updatedAt
  }

  private async isCoveredByRemoteTombstone(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    bundledRecords: Map<string, LocalRecord>,
    remoteTombstoneRecordCache: Map<string, LocalRecord | null>
  ) {
    const target = tombstoneTargetFromRecord(record.table.entityType, record.idValues)
    if (!target) return false

    for (const [tombstoneId, meta] of Object.entries(manifest.records)) {
      if (meta.entityType !== TOMBSTONE_ENTITY_TYPE) continue

      const tombstone = await this.getRemoteTombstoneTarget(
        client,
        basePath,
        tombstoneId,
        meta,
        bundledRecords,
        remoteTombstoneRecordCache
      )
      if (!tombstone) continue

      if (
        tombstone.target.entityType === target.entityType &&
        sameIdValues(tombstone.target.idValues, target.idValues) &&
        tombstone.updatedAt >= record.updatedAt
      ) {
        return true
      }
    }

    return false
  }

  private async getRemoteTombstoneTarget(
    client: WebDAVClient,
    basePath: string,
    tombstoneId: string,
    meta: RemoteRecordMeta,
    bundledRecords: Map<string, LocalRecord>,
    remoteTombstoneRecordCache: Map<string, LocalRecord | null>
  ) {
    let target = tombstoneTargetFromMeta(meta)
    let updatedAt = meta.updatedAt

    if (!target) {
      let tombstoneRecord = bundledRecords.get(tombstoneId) ?? remoteTombstoneRecordCache.get(tombstoneId)
      if (tombstoneRecord === undefined) {
        tombstoneRecord = await this.pullRecord(client, basePath, meta, bundledRecords.get(tombstoneId))
        remoteTombstoneRecordCache.set(tombstoneId, tombstoneRecord)
      }
      if (!tombstoneRecord) return null

      target = tombstoneTargetFromRow(tombstoneRecord.row)
      updatedAt = tombstoneRecord.updatedAt
    }

    return target ? { target, updatedAt } : null
  }

  private async isStaleRemoteTombstoneCoveredByLocalRecord(
    client: WebDAVClient,
    basePath: string,
    tombstoneId: string,
    meta: RemoteRecordMeta,
    localById: Map<string, LocalRecord>,
    bundledRecords: Map<string, LocalRecord>,
    remoteTombstoneRecordCache: Map<string, LocalRecord | null>
  ) {
    if (meta.entityType !== TOMBSTONE_ENTITY_TYPE) return false

    const tombstone = await this.getRemoteTombstoneTarget(
      client,
      basePath,
      tombstoneId,
      meta,
      bundledRecords,
      remoteTombstoneRecordCache
    )
    if (!tombstone) return false

    const targetRecord = localById.get(recordId(tombstone.target.entityType, tombstone.target.idValues))
    return Boolean(targetRecord && !targetRecord.deletedAt && targetRecord.updatedAt > tombstone.updatedAt)
  }

  private blobLocalPath(storagePath: string) {
    const dataRoot = path.resolve(storageV2DataRootService.ensureDataRoot().dataRoot)
    const localPath = path.resolve(dataRoot, normalizeLocalStoragePath(storagePath))
    if (localPath !== dataRoot && !localPath.startsWith(`${dataRoot}${path.sep}`)) {
      throw new Error('Storage v2 blob path is invalid')
    }
    return localPath
  }

  private async pushBlobFile(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    record: LocalRecord,
    summary: StorageV2WebDavRecordSyncSummary,
    signal?: AbortSignal
  ) {
    const storagePathColumn = record.table.blobStoragePathColumn
    const checksumColumn = record.table.blobChecksumColumn
    if (!storagePathColumn || !checksumColumn) return

    const blobId = record.idValues[0]
    const storagePath = String(record.row[storagePathColumn] ?? '')
    const checksum = String(record.row[checksumColumn] ?? '')
    if (!blobId || !storagePath || !checksum) return

    const localPath = this.blobLocalPath(storagePath)
    if (!fs.existsSync(localPath)) {
      throw new Error(`本地附件文件缺失，无法同步 blob ${blobId}。请先恢复本地文件，或删除对应引用后再同步。`)
    }

    const stat = await fsp.stat(localPath)
    if (stat.size > MAX_SYNC_BLOB_BYTES) {
      throw new Error(
        `同步数据失败：附件 ${blobId} 过大（${stat.size} 字节，限制 ${MAX_SYNC_BLOB_BYTES} 字节）。` +
          'WebDAV 多端同步不适合搬运超大附件；请删除该附件引用或改用手动备份。'
      )
    }

    const actualChecksum = await sha256File(localPath)
    if (actualChecksum !== checksum) {
      throw new Error(`本地附件文件校验失败，无法同步 blob ${blobId}。请先恢复或重新生成这个文件。`)
    }

    const remote = manifest.blobs[blobId]
    if (remote?.checksum === checksum && remote.byteSize === stat.size) return

    const relativePath = blobPath(blobId, checksum)
    await this.ensureDirectory(client, path.posix.dirname(path.posix.join(basePath, relativePath)), signal)
    const remotePath = path.posix.join(basePath, relativePath)
    await runWebDavOperation(
      `uploading Storage v2 blob ${remotePath}`,
      () =>
        client.putFileContents(remotePath, fs.createReadStream(localPath), {
          overwrite: true,
          contentLength: stat.size,
          ...(signal ? { signal } : {})
        }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS, signal }
    )

    await this.assertRemoteBlobIntegrity(client, remotePath, blobId, checksum, stat.size, signal)

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
    summary: StorageV2WebDavRecordSyncSummary,
    signal?: AbortSignal
  ) {
    const storagePathColumn = record.table.blobStoragePathColumn
    const checksumColumn = record.table.blobChecksumColumn
    if (!storagePathColumn || !checksumColumn) return

    const blobId = record.idValues[0]
    const expectedStoragePath = String(record.row[storagePathColumn] ?? '')
    const expectedChecksum = String(record.row[checksumColumn] ?? '')
    if (!blobId || !expectedStoragePath || !expectedChecksum) {
      throw new Error(`远端附件记录 ${record.id} 缺少必要的文件路径或校验信息，本次同步已停止。`)
    }

    const blob = manifest.blobs[blobId]
    if (!blob) {
      throw new Error(
        `远端 Storage v2 manifest 缺少 blob ${blobId} 的文件元数据。为避免导入不完整数据，本次同步已停止。`
      )
    }
    const expectedByteSizeValue = record.row.byte_size ?? record.row.size ?? record.row.byteSize
    const hasExpectedByteSize =
      expectedByteSizeValue !== undefined && expectedByteSizeValue !== null && expectedByteSizeValue !== ''
    const expectedByteSize = hasExpectedByteSize ? Number(expectedByteSizeValue) : null
    if (
      hasExpectedByteSize &&
      (expectedByteSize === null || !Number.isFinite(expectedByteSize) || expectedByteSize < 0)
    ) {
      throw new Error(`远端附件记录 ${record.id} 缺少有效的文件大小，本次同步已停止。`)
    }
    if (
      blob.storagePath !== expectedStoragePath ||
      blob.checksum !== expectedChecksum ||
      (expectedByteSize !== null && blob.byteSize !== expectedByteSize)
    ) {
      throw new Error(
        `远端附件 ${blobId} 的文件元数据与 Storage v2 记录不一致。为避免写入无法打开或校验失败的本地附件，本次同步已停止。`
      )
    }
    if (!Number.isFinite(blob.byteSize) || blob.byteSize < 0) {
      throw new Error(`远端附件文件大小无效，blob ${blobId} 已停止同步。`)
    }
    if (blob.byteSize > MAX_SYNC_BLOB_BYTES) {
      throw new Error(
        `远端附件文件过大，blob ${blobId}（${blob.byteSize} 字节，限制 ${MAX_SYNC_BLOB_BYTES} 字节）。WebDAV 多端同步不适合搬运超大附件，本次同步已停止。`
      )
    }

    const localPath = this.blobLocalPath(expectedStoragePath)
    if (fs.existsSync(localPath)) {
      try {
        if ((await sha256File(localPath)) === blob.checksum) return
      } catch {
        // fall through and redownload the blob
      }
    }

    const remotePath = path.posix.join(basePath, safeRemoteRelativePath(blob.path))
    await this.assertRemoteFileWithinByteLimit(
      client,
      remotePath,
      `远端附件文件 blob ${blobId}`,
      MAX_SYNC_BLOB_BYTES,
      signal
    )
    const contents = await runWebDavOperation(
      `downloading Storage v2 blob ${remotePath}`,
      () => client.getFileContents(remotePath, withStorageWebDavSignal({ format: 'binary' as const }, signal)),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS, signal }
    )
    const buffer = bufferFromRemoteContents(contents)
    this.assertBlobBufferIntegrity(buffer, blobId, blob.checksum, blob.byteSize)

    await fsp.mkdir(path.dirname(localPath), { recursive: true })
    const tempPath = `${localPath}.sync-download-${process.pid}-${Date.now()}`
    try {
      await fsp.writeFile(tempPath, buffer)
      await fsp.rename(tempPath, localPath)
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    }
    summary.blobDownloaded += 1
  }

  private async prepareRemoteRecordForLocalApply(
    client: WebDAVClient,
    basePath: string,
    manifest: StorageV2WebDavRecordSyncManifest,
    remoteRecord: LocalRecord,
    options: StorageV2WebDavRecordSyncOptions,
    remoteSecretVaultCache: RemoteSecretVaultCache,
    summary: StorageV2WebDavRecordSyncSummary
  ) {
    options.assertActive?.()
    await this.assertRemoteSecretsAvailableForRecord(
      client,
      basePath,
      manifest,
      remoteRecord,
      options,
      remoteSecretVaultCache,
      summary
    )
    options.assertActive?.()
    await this.ensureRemoteBlobFile(client, basePath, manifest, remoteRecord, summary, options.signal)
  }

  private assertBlobBufferIntegrity(buffer: Buffer, blobId: string, checksum: string, byteSize: number) {
    if (buffer.byteLength !== byteSize) {
      throw new Error(`远端附件文件大小不匹配，blob ${blobId} 已停止同步。`)
    }

    if (sha256Buffer(buffer) !== checksum) {
      throw new Error(`远端附件文件校验失败，blob ${blobId} 已停止同步。`)
    }
  }

  private async assertRemoteBlobIntegrity(
    client: WebDAVClient,
    remotePath: string,
    blobId: string,
    checksum: string,
    byteSize: number,
    signal?: AbortSignal
  ) {
    const contents = await runWebDavOperation(
      `verifying uploaded Storage v2 blob ${remotePath}`,
      () => client.getFileContents(remotePath, withStorageWebDavSignal({ format: 'binary' as const }, signal)),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS, signal }
    )
    this.assertBlobBufferIntegrity(bufferFromRemoteContents(contents), blobId, checksum, byteSize)
  }

  private sortRecordIds(ids: Iterable<string>) {
    return Array.from(ids).sort((left, right) => {
      const leftEntity = left.slice(0, left.indexOf(':'))
      const rightEntity = right.slice(0, right.indexOf(':'))
      const weightDiff = this.tableWeight(leftEntity) - this.tableWeight(rightEntity)
      return weightDiff !== 0 ? weightDiff : left.localeCompare(right)
    })
  }

  async sync(
    client: WebDAVClient,
    basePath: string,
    manifestInput?: StorageV2WebDavRecordSyncManifest | null,
    options: StorageV2WebDavRecordSyncOptions = {}
  ): Promise<StorageV2WebDavRecordSyncResult> {
    this.skillIdRemaps.clear()
    const dbClient = await storageV2Database.getClient()
    const manifest = normalizeManifest(manifestInput ?? makeManifest())
    const summary = { ...EMPTY_SUMMARY }
    const pendingSyncStates = new Map<string, string>()
    const remoteSecretVaultCache: RemoteSecretVaultCache = {
      loaded: false,
      secrets: null,
      importedSecretIds: new Set()
    }
    const remoteTombstoneRecordCache = new Map<string, LocalRecord | null>()
    const stageRecordSyncState = (id: string, valueHash: string) => {
      pendingSyncStates.set(id, valueHash)
    }
    options.assertActive?.()
    await this.ensureDirectory(client, basePath, options.signal)
    options.assertActive?.()
    if (!options.skipWriteAccessProbe) {
      await this.assertWriteAccess(client, basePath, options.signal)
    }
    options.assertActive?.()
    const localRecords = await this.listLocalRecords(dbClient)
    options.assertActive?.()
    const localById = new Map(localRecords.map((record) => [record.id, record]))
    const firstJoinRequiredUploadIds = collectFirstJoinRequiredUploadIds(localRecords)
    const initialBundleMeta = manifest.bundle
    const remoteBundle = await this.readRecordBundle(client, basePath, manifest, options.signal)
    options.assertActive?.()
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
    this.assertRemoteManifestEntitiesSupported(manifest)
    const ids = this.sortRecordIds(new Set([...localById.keys(), ...Object.keys(manifest.records)]))

    for (const id of ids) {
      options.assertActive?.()
      const localRecord = localById.get(id)
      const remoteMeta = manifest.records[id]
      const bundledRecord = bundledRecords.get(id)
      const lastHash = await this.getRecordSyncState(dbClient, id)
      options.assertActive?.()

      if (localRecord && !remoteMeta) {
        if (
          options.preferRemoteOnFirstJoin === true &&
          !lastHash &&
          (await this.discardLocalFirstJoinTombstoneIfRemoteHasRecord(dbClient, manifest, localRecord, bundledRecords))
        ) {
          summary.storageSkipped += 1
          continue
        }

        if (
          await this.isCoveredByRemoteTombstone(
            client,
            basePath,
            manifest,
            localRecord,
            bundledRecords,
            remoteTombstoneRecordCache
          )
        ) {
          summary.storageSkipped += 1
          continue
        }

        if (
          options.preferRemoteOnFirstJoin === true &&
          !lastHash &&
          shouldDeferLocalOnlyFirstJoinRecord(localRecord) &&
          !firstJoinRequiredUploadIds.has(localRecord.id)
        ) {
          stageRecordSyncState(id, deferredLocalRecordHash(localRecord.valueHash))
          summary.storageSkipped += 1
          continue
        }

        if (lastHash === deferredLocalRecordHash(localRecord.valueHash)) {
          summary.storageSkipped += 1
          continue
        }

        options.assertActive?.()
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords, options.signal)
        options.assertActive?.()
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary, options.signal)
        options.assertActive?.()
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        stageRecordSyncState(id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localRecord && remoteMeta) {
        if (
          await this.isStaleRemoteTombstoneCoveredByLocalRecord(
            client,
            basePath,
            id,
            remoteMeta,
            localById,
            bundledRecords,
            remoteTombstoneRecordCache
          )
        ) {
          delete manifest.records[id]
          bundledRecords.delete(id)
          summary.storageSkipped += 1
          continue
        }

        const coveredByLocalTombstone = await this.isCoveredByLocalTombstone(dbClient, remoteMeta)
        if (coveredByLocalTombstone && !(options.preferRemoteOnFirstJoin === true && !lastHash)) {
          delete manifest.records[id]
          bundledRecords.delete(id)
          summary.storageSkipped += 1
          continue
        }

        options.assertActive?.()
        const remoteRecord = await this.pullRecord(client, basePath, remoteMeta, bundledRecord, options.signal)
        if (remoteRecord) {
          options.assertActive?.()
          await this.prepareRemoteRecordForLocalApply(
            client,
            basePath,
            manifest,
            remoteRecord,
            options,
            remoteSecretVaultCache,
            summary
          )
          options.assertActive?.()
          await this.applyRemoteRecordOrThrow(dbClient, remoteRecord)
          bundledRecords.set(id, remoteRecord)
          manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
          this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
          stageRecordSyncState(id, remoteRecord.valueHash)
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
        const remoteRecordAccessible = await this.hasRemoteRecord(
          client,
          basePath,
          remoteMeta,
          bundledRecord,
          options.signal
        )
        if (!remoteRecordAccessible) {
          options.assertActive?.()
          await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords, options.signal)
          options.assertActive?.()
          await this.pushBlobFile(client, basePath, manifest, localRecord, summary, options.signal)
          options.assertActive?.()
          await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
          stageRecordSyncState(id, localRecord.valueHash)
          summary.storageUploaded += localRecord.deletedAt ? 0 : 1
          summary.storageDeleted += localRecord.deletedAt ? 1 : 0
          continue
        }

        options.assertActive?.()
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary, options.signal)
        options.assertActive?.()
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        bundledRecords.set(id, localRecord)
        manifest.records[id] = recordMetaFromLocalRecord(localRecord, recordBundlePath())
        stageRecordSyncState(id, localRecord.valueHash)
        summary.storageSkipped += 1
        continue
      }

      const localChanged = hasLocalRecordChangedSinceSync(lastHash, localRecord.valueHash)
      options.assertActive?.()
      const remoteRecord = await this.pullRecord(client, basePath, remoteMeta, bundledRecord, options.signal)
      if (!remoteRecord) {
        summary.storageSkipped += 1
        continue
      }

      if (this.areRecordRowsEquivalent(localRecord, remoteRecord)) {
        const localWins = this.shouldLocalRecordWin(localRecord, remoteRecord)
        const remoteWins = !localWins
        const winner = localWins ? localRecord : remoteRecord

        if (remoteWins) {
          options.assertActive?.()
          await this.prepareRemoteRecordForLocalApply(
            client,
            basePath,
            manifest,
            remoteRecord,
            options,
            remoteSecretVaultCache,
            summary
          )
          options.assertActive?.()
          await this.applyRemoteRecordOrThrow(dbClient, remoteRecord)
        }

        bundledRecords.set(id, winner)
        manifest.records[id] = recordMetaFromLocalRecord(winner, recordBundlePath())
        stageRecordSyncState(id, winner.valueHash)
        this.pruneManifestRecordCoveredByTombstone(manifest, winner.row, bundledRecords)
        options.assertActive?.()
        await this.applyLocalTombstoneRecord(dbClient, manifest, winner, bundledRecords)
        summary.storageSkipped += 1
        continue
      }

      const remoteChanged = remoteRecord.valueHash !== lastHash

      if (!lastHash) {
        const treatAsFirstJoinHydration = options.preferRemoteOnFirstJoin === true
        if (!treatAsFirstJoinHydration) {
          await this.recordConflictAudit(dbClient, {
            localRecord,
            remoteRecord,
            baseHash: null,
            resolvedAt: new Date().toISOString()
          })
        }
        options.assertActive?.()
        await options.beforeRemoteConflictApply?.({ id, baseHash: null, firstJoin: true })
        options.assertActive?.()
        await this.prepareRemoteRecordForLocalApply(
          client,
          basePath,
          manifest,
          remoteRecord,
          options,
          remoteSecretVaultCache,
          summary
        )
        options.assertActive?.()
        await this.applyRemoteRecordOrThrow(dbClient, remoteRecord)
        bundledRecords.set(id, remoteRecord)
        manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
        this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
        stageRecordSyncState(id, remoteRecord.valueHash)
        summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
        summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        summary.storageResolvedConflicts += treatAsFirstJoinHydration ? 0 : 1
        continue
      }

      if (localChanged && !remoteChanged) {
        options.assertActive?.()
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords, options.signal)
        options.assertActive?.()
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary, options.signal)
        options.assertActive?.()
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        stageRecordSyncState(id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
        summary.storageDeleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localChanged && remoteChanged) {
        options.assertActive?.()
        await this.prepareRemoteRecordForLocalApply(
          client,
          basePath,
          manifest,
          remoteRecord,
          options,
          remoteSecretVaultCache,
          summary
        )
        options.assertActive?.()
        await this.applyRemoteRecordOrThrow(dbClient, remoteRecord)
        bundledRecords.set(id, remoteRecord)
        manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
        this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
        stageRecordSyncState(id, remoteRecord.valueHash)
        summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
        summary.storageDeleted += remoteRecord.deletedAt ? 1 : 0
        continue
      }

      const localWins = this.shouldLocalRecordWin(localRecord, remoteRecord)
      if (localWins) {
        options.assertActive?.()
        await this.pushRecord(client, basePath, manifest, localRecord, bundledRecords, options.signal)
        options.assertActive?.()
        await this.pushBlobFile(client, basePath, manifest, localRecord, summary, options.signal)
        options.assertActive?.()
        await this.applyLocalTombstoneRecord(dbClient, manifest, localRecord, bundledRecords)
        stageRecordSyncState(id, localRecord.valueHash)
        summary.storageUploaded += localRecord.deletedAt ? 0 : 1
      } else {
        options.assertActive?.()
        await options.beforeRemoteConflictApply?.({ id, baseHash: lastHash, firstJoin: false })
        options.assertActive?.()
        await this.prepareRemoteRecordForLocalApply(
          client,
          basePath,
          manifest,
          remoteRecord,
          options,
          remoteSecretVaultCache,
          summary
        )
        options.assertActive?.()
        await this.applyRemoteRecordOrThrow(dbClient, remoteRecord)
        bundledRecords.set(id, remoteRecord)
        manifest.records[id] = recordMetaFromLocalRecord(remoteRecord, recordBundlePath())
        this.pruneManifestRecordCoveredByTombstone(manifest, remoteRecord.row, bundledRecords)
        stageRecordSyncState(id, remoteRecord.valueHash)
        summary.storageDownloaded += remoteRecord.deletedAt ? 0 : 1
      }
      await this.recordConflictAudit(dbClient, {
        localRecord,
        remoteRecord,
        baseHash: lastHash,
        resolvedAt: new Date().toISOString()
      })
      summary.storageResolvedConflicts += 1
    }

    options.assertActive?.()
    this.pruneManifestBlobsWithoutRecords(manifest, bundledRecords)
    const bundledSecretReferenceScan = this.collectBundledRecordSecretRefs(bundledRecords.values())
    const secretReferenceScan =
      options.preferRemoteOnFirstJoin === true
        ? {
            refs: new Set<string>(),
            invalidRefs: new Set<string>(),
            skippedSources: []
          }
        : await scanStorageV2SecretReferences(dbClient)
    options.assertActive?.()
    const invalidSecretRefs = new Set([...secretReferenceScan.invalidRefs, ...bundledSecretReferenceScan.invalidRefs])
    if (invalidSecretRefs.size > 0) {
      throw new Error(
        `Storage v2 数据中存在无法识别的敏感配置引用：${formatLimitedList(
          invalidSecretRefs
        )}。请重新保存对应模型、服务或设置后再同步。`
      )
    }
    const referencedSecretIds = new Set([...secretReferenceScan.refs, ...bundledSecretReferenceScan.refs])

    await this.syncSecretVault(
      client,
      basePath,
      manifest,
      summary,
      options,
      referencedSecretIds,
      remoteSecretVaultCache.importedSecretIds
    )
    options.assertActive?.()
    await this.writeRecordBundle(client, basePath, manifest, bundledRecords, {
      verifiedRemoteBundle:
        remoteBundle && initialBundleMeta
          ? {
              path: initialBundleMeta.path,
              valueHash: initialBundleMeta.valueHash
            }
          : null,
      signal: options.signal
    })
    options.assertActive?.()
    return {
      manifest,
      summary,
      syncStates: Array.from(pendingSyncStates.entries()).map(([id, valueHash]) => ({ id, valueHash }))
    }
  }
}

export const storageV2WebDavRecordSyncService = new StorageV2WebDavRecordSyncService()
