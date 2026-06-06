import { createHash, randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import { createClient as createLibsqlClient } from '@libsql/client'
import { loggerService } from '@logger'
import BackupManager from '@main/services/BackupManager'
import MemoryService from '@main/services/memory/MemoryService'
import { storageV2AgentLegacyProjectionService } from '@main/services/storageV2/AgentLegacyProjectionService'
import { storageV2AppDataKvMirrorService } from '@main/services/storageV2/AppDataKvMirrorService'
import { storageV2AppDataLegacyProjectionService } from '@main/services/storageV2/AppDataLegacyProjectionService'
import { storageV2AppDataRuntimeRecoveryService } from '@main/services/storageV2/AppDataRuntimeRecoveryService'
import { storageV2DataRootService } from '@main/services/storageV2/DataRootService'
import { storageV2FileLegacyProjectionService } from '@main/services/storageV2/FileLegacyProjectionService'
import {
  type StorageV2WebDavRecordSyncManifest,
  storageV2WebDavRecordSyncService,
  type StorageV2WebDavRecordSyncStateCommit,
  type StorageV2WebDavRecordSyncSummary
} from '@main/services/storageV2/WebDavRecordSyncService'
import { hashJsonValue, writeWebDavJsonAtomically } from '@main/services/WebDavAtomic'
import { normalizeWebDavHost, runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import { getDataPath } from '@main/utils'
import { getNotesDir } from '@main/utils/file'
import { normalizeWebDavConfig } from '@shared/webdavConfig'
import type { WebDavConfig } from '@types'
import { XMLParser } from 'fast-xml-parser'
import { createClient, type FileStat, type WebDAVClient } from 'webdav'

import { type AppDataDatabase, type AppDataRecord, getAppDataDatabase } from './AppDataDatabase'
import { mergeAppDataRecords } from './AppDataRecordMerge'

const logger = loggerService.withContext('AppDataSyncService')
const DATA_SYNC_ALREADY_RUNNING_ERROR = 'Data sync is already running'
const LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000
const EMPTY_RUNTIME_DIRECTORY_VALUE_HASH = hashJsonValue([])

type RemoteRecordMeta = {
  scope: string
  key: string
  valueHash: string
  updatedAt: number
  deletedAt?: number | null
  deviceId: string
  version: number
  path: string
}

type RemoteManifest = {
  version: 1
  generation: number
  updatedAt: number
  records: Record<string, RemoteRecordMeta>
  syncSpace?: RemoteSyncSpace | null
  storageV2?: StorageV2WebDavRecordSyncManifest | null
  notes?: RemoteNotesManifest | null
  runtimeDirectories?: RemoteRuntimeDirectoriesManifest | null
  latestSnapshot?: RemoteSnapshotMeta | null
  snapshots?: Record<string, RemoteSnapshotMeta>
}

type RemoteNotesFileMeta = {
  version: 1
  relativePath: string
  valueHash: string
  byteSize: number
  updatedAt: number
  deletedAt?: number | null
  deviceId: string
  path: string | null
}

type RemoteNotesManifest = {
  version: 1
  updatedAt: number
  files: Record<string, RemoteNotesFileMeta>
}

type LocalNotesFile = {
  relativePath: string
  localPath: string
  valueHash: string
  byteSize: number
  updatedAt: number
}

type RemoteRuntimeDirectoryMeta = {
  version: 1
  name: RuntimeDirectoryName
  valueHash: string
  byteSize: number
  compressedByteSize: number
  fileCount: number
  updatedAt: number
  deviceId: string
  path: string
}

type RemoteRuntimeDirectoriesManifest = {
  version: 1
  updatedAt: number
  directories: Record<string, RemoteRuntimeDirectoryMeta>
}

type RuntimeDirectoryFileEntry = {
  relativePath: string
  valueHash: string
  byteSize: number
  updatedAt: number
  mode: number
  contentBase64: string
}

type RuntimeDirectoryBundle = {
  version: 1
  name: RuntimeDirectoryName
  updatedAt: number
  files: Record<string, RuntimeDirectoryFileEntry>
}

type LocalRuntimeDirectorySnapshot = {
  name: RuntimeDirectoryName
  rootDir: string
  fileCount: number
  byteSize: number
  compressedByteSize: number
  updatedAt: number
  valueHash: string
  bundle: Buffer
}

type RuntimeDirectoryName = 'Memory' | 'Skills' | 'MCP' | 'Channels'

type RuntimeDirectoryPolicy = {
  name: RuntimeDirectoryName
  maxTotalBytes: number
  maxFileBytes: number
  maxFileCount: number
  snapshot?: 'memory'
}

type RemoteSyncSpace = {
  version: 1
  id: string
  createdAt: number
  keyMaterial: string
  keyFormat: 'cherry-sync-space-key-v1'
  secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
}

type RemoteSnapshotMeta = {
  id: string
  fileName: string
  path: string
  byteSize: number
  checksum?: string
  createdAt: string
  uploadedAt: number
  deviceId: string
  format: 'cherry-studio-direct-backup-zip'
}

type RemoteSyncLock = {
  version: 1
  ownerId: string
  token: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  leaseMs: number
  deadlineAt?: number
  maxRuntimeMs?: number
  runtimeId?: string
  app: 'cherry-studio-pi'
  reason: 'data-sync'
}

type RemoteSyncLockHandle = {
  type: 'webdav' | 'file'
  path: string
  ownerId: string
  token: string
  runtimeId?: string
  previousHeaders?: Record<string, string> | null
}

type RemoteSyncLockEntry = {
  path: string
  lock: RemoteSyncLock
}

type RemoteManifestBaseline = {
  existed: boolean
  generation: number
  hash: string | null
}

type SyncRunContext = {
  startedAt: number
  deadlineAt: number
  maxRuntimeMs: number
  aborted: boolean
  abortReason: string | null
}

export type DataSyncRemoteDirectory = {
  name: string
  path: string
  modifiedAt: string | null
}

export type DataSyncRemoteDirectoryList = {
  path: string
  parentPath: string | null
  directories: DataSyncRemoteDirectory[]
}

export type DataSyncWriteAccessResult = {
  ok: true
  basePath: string
}

export type DataSyncSummary = {
  status?: 'success' | 'failed'
  error?: string | null
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  resolvedConflicts: number
  skipped: number
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
  snapshotUploaded: boolean
  snapshotFileName: string | null
  snapshotBytes: number
  joinSafetySnapshotCreated: boolean
  joinSafetySnapshotFileName: string | null
  joinSafetySnapshotPath: string | null
  joinSafetySnapshotBytes: number
  remotePath: string | null
  remoteGeneration: number | null
  remoteManifestHash: string | null
  syncSpaceId: string | null
  storageBundleHash: string | null
  storageRecordCount: number
  storageBlobCount: number
  lastSyncAt: number
}

type DataSyncFailureSafetySnapshot = Pick<
  DataSyncSummary,
  | 'joinSafetySnapshotCreated'
  | 'joinSafetySnapshotFileName'
  | 'joinSafetySnapshotPath'
  | 'joinSafetySnapshotBytes'
  | 'lastSyncAt'
>

const EMPTY_SUMMARY: DataSyncSummary = {
  status: undefined,
  error: null,
  uploaded: 0,
  downloaded: 0,
  deleted: 0,
  conflicts: 0,
  resolvedConflicts: 0,
  skipped: 0,
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageResolvedConflicts: 0,
  storageSkipped: 0,
  blobUploaded: 0,
  blobDownloaded: 0,
  secretUploaded: 0,
  secretDownloaded: 0,
  snapshotUploaded: false,
  snapshotFileName: null,
  snapshotBytes: 0,
  joinSafetySnapshotCreated: false,
  joinSafetySnapshotFileName: null,
  joinSafetySnapshotPath: null,
  joinSafetySnapshotBytes: 0,
  remotePath: null,
  remoteGeneration: null,
  remoteManifestHash: null,
  syncSpaceId: null,
  storageBundleHash: null,
  storageRecordCount: 0,
  storageBlobCount: 0,
  lastSyncAt: 0
}

const SNAPSHOT_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000
const REMOTE_FULL_SNAPSHOT_OPT_IN_ENV = 'CHERRY_STUDIO_DATA_SYNC_REMOTE_SNAPSHOT'
const LOCAL_JOIN_SAFETY_SNAPSHOT_OPT_IN_ENV = 'CHERRY_STUDIO_DATA_SYNC_LOCAL_SAFETY_SNAPSHOT'
const DATA_SYNC_REMOTE_ROOT = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'
const REMOTE_MANIFEST_MAX_BYTES = 16 * 1024 * 1024
const REMOTE_APP_DATA_RECORD_MAX_BYTES = 2 * 1024 * 1024
const SYNC_SPACE_KEY_FORMAT = 'cherry-sync-space-key-v1' as const
const SYNC_SPACE_SECRET_ENCRYPTION = 'cherry-webdav-secret-sync-aes-256-gcm' as const
const DATA_SYNC_TEMP_BACKUP_FILE_PATTERN = /^cherry-studio-pi\.data-sync\..+\.zip$/
const DATA_SYNC_JOIN_SAFETY_FILE_PATTERN = /^cherry-studio-pi\.data-sync\.join-safety\..+\.zip$/
const DATA_SYNC_JOIN_SAFETY_LOCAL_RETENTION = 1
const DATA_SYNC_SYNC_SPACE_ID_STATE_KEY = 'data-sync-sync-space-id'
const STORAGE_V2_RUNTIME_PROJECTION_HASH_KEY = 'storage-v2-runtime-projection-hash'
const NOTES_REMOTE_ARTIFACT_ROOT = 'notes'
const NOTES_SYNC_STATE_PREFIX = 'notes-file'
const NOTES_MAX_FILE_BYTES = 64 * 1024 * 1024
const NOTES_MAX_TOTAL_BYTES = 512 * 1024 * 1024
const NOTES_MAX_FILE_COUNT = 10_000
const RUNTIME_DIRECTORIES_REMOTE_ROOT = 'runtime-directories'
const RUNTIME_DIRECTORY_SYNC_STATE_PREFIX = 'runtime-directory'
const RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024
const RUNTIME_DIRECTORY_DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024
const RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_COUNT = 10_000
const RUNTIME_DIRECTORY_POLICIES: readonly RuntimeDirectoryPolicy[] = [
  {
    name: 'Memory',
    maxFileBytes: 16 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
    maxFileCount: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_COUNT,
    snapshot: 'memory'
  },
  {
    name: 'Skills',
    maxFileBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_TOTAL_BYTES,
    maxFileCount: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_COUNT
  },
  {
    name: 'MCP',
    maxFileBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_TOTAL_BYTES,
    maxFileCount: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_COUNT
  },
  {
    name: 'Channels',
    maxFileBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: RUNTIME_DIRECTORY_DEFAULT_MAX_TOTAL_BYTES,
    maxFileCount: RUNTIME_DIRECTORY_DEFAULT_MAX_FILE_COUNT
  }
] as const
const LEGACY_REMOTE_SYNC_LOCK_FILE = '.sync.lock.json'
const REMOTE_SYNC_LOCK_DIR = '.sync.locks'
const REMOTE_SYNC_LOCK_MAX_BYTES = 64 * 1024
const REMOTE_SYNC_LOCK_CLAIM_MAX_COUNT = 256
const REMOTE_SYNC_LOCK_TTL_MS = 2 * 60 * 1000
const REMOTE_SYNC_LOCK_RENEW_INTERVAL_MS = 30 * 1000
const REMOTE_SYNC_LOCK_STALE_HEARTBEAT_MS = 3 * 60 * 1000
const DEFAULT_DATA_SYNC_MAX_RUNTIME_MS = 10 * 60 * 1000
const DATA_SYNC_MAX_RUNTIME_ENV = 'CHERRY_STUDIO_DATA_SYNC_MAX_RUNTIME_MS'
const DATA_SYNC_CLEANUP_MAX_FILES_ENV = 'CHERRY_STUDIO_DATA_SYNC_CLEANUP_MAX_FILES'
const DATA_SYNC_LAST_REMOTE_ARTIFACT_CLEANUP_AT_STATE_KEY = 'data-sync-last-remote-artifact-cleanup-at'
const DEFAULT_REMOTE_ARTIFACT_CLEANUP_MAX_FILES = 20_000
const REMOTE_ARTIFACT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_RETENTION_PER_DEVICE = 3
const SNAPSHOT_RETENTION_TOTAL = 20
const NATIVE_WEB_DAV_LOCK_UNSUPPORTED_STATUSES = new Set([403, 405, 409, 501])
const NATIVE_WEB_DAV_LOCK_OPT_IN_ENV = 'CHERRY_STUDIO_DATA_SYNC_NATIVE_WEB_DAV_LOCK'
const STORAGE_V2_WRITE_ACCESS_PROBE_DIRS = [
  'storage-v2/bundle',
  'storage-v2/secrets',
  'storage-v2/blobs',
  NOTES_REMOTE_ARTIFACT_ROOT,
  `${RUNTIME_DIRECTORIES_REMOTE_ROOT}/bundles`
] as const

const AGENT_RUNTIME_ENTITY_TYPES = new Set([
  'agent',
  'agent_version',
  'agent_skill',
  'agent_session',
  'channel',
  'channel_task_subscription',
  'conversation',
  'message',
  'message_block',
  'scheduled_task',
  'skill',
  'sync_tombstone',
  'task_run_log'
])

const FILE_RUNTIME_ENTITY_TYPES = new Set(['blob', 'file'])
const APP_DATA_RUNTIME_ENTITY_TYPES = new Set(['kv_record'])
const RENDERER_HYDRATION_ENTITY_TYPES = new Set([
  'profile',
  'provider',
  'provider_credential',
  'model',
  'assistant',
  'assistant_version',
  'knowledge_base',
  'knowledge_item',
  'settings'
])

function recordId(scope: string, key: string) {
  return `${scope}:${key}`
}

function shouldLocalAppRecordWin(localRecord: AppDataRecord, remoteRecord: AppDataRecord) {
  if (localRecord.updatedAt !== remoteRecord.updatedAt) {
    return localRecord.updatedAt > remoteRecord.updatedAt
  }

  if (localRecord.version !== remoteRecord.version) {
    return localRecord.version > remoteRecord.version
  }

  return localRecord.valueHash >= remoteRecord.valueHash
}

function encodePart(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function recordPath(record: Pick<AppDataRecord, 'scope' | 'key' | 'valueHash'>) {
  return `records/${encodePart(record.scope)}/${encodePart(record.key)}/${encodePart(record.valueHash)}.json`
}

function normalizeWebDavDirectoryPath(webdavPath?: string) {
  const trimmed = webdavPath?.trim() || DATA_SYNC_REMOTE_ROOT
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const normalized = path.posix.normalize(withSlash.replace(/\\/g, '/').replace(/\/+/g, '/'))
  const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/g, '') : normalized
  return withoutTrailingSlash === '.' ? '/' : withoutTrailingSlash
}

function normalizeBasePath(webdavPath?: string) {
  const basePath = normalizeWebDavDirectoryPath(webdavPath)
  return basePath === DATA_SYNC_SUFFIX || basePath.endsWith(DATA_SYNC_SUFFIX)
    ? basePath
    : path.posix.join(basePath, 'sync', 'v1')
}

function redactWebDavHostForLog(webdavHost: string) {
  try {
    const url = new URL(webdavHost)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return webdavHost.replace(/\s+/g, ' ')
  }
}

function parentDirectoryPath(directoryPath: string) {
  if (directoryPath === '/') return null
  return path.posix.dirname(directoryPath) || '/'
}

function normalizeDirectoryContents(contents: unknown): FileStat[] {
  if (Array.isArray(contents)) {
    return contents as FileStat[]
  }

  const detailedData = (contents as { data?: unknown } | null)?.data
  return Array.isArray(detailedData) ? (detailedData as FileStat[]) : []
}

function makeManifest(): RemoteManifest {
  return {
    version: 1,
    generation: 0,
    updatedAt: Date.now(),
    records: {},
    syncSpace: null,
    storageV2: null,
    notes: null,
    runtimeDirectories: null,
    latestSnapshot: null,
    snapshots: {}
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function randomSyncSpaceKeyMaterial() {
  return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function makeSyncSpace(now = Date.now()): RemoteSyncSpace {
  return {
    version: 1,
    id: `sync-space-${randomUUID()}`,
    createdAt: now,
    keyMaterial: randomSyncSpaceKeyMaterial(),
    keyFormat: SYNC_SPACE_KEY_FORMAT,
    secretEncryption: SYNC_SPACE_SECRET_ENCRYPTION
  }
}

function isUsableSyncSpace(value: RemoteSyncSpace | null | undefined): value is RemoteSyncSpace {
  return (
    value?.version === 1 &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.keyMaterial === 'string' &&
    value.keyMaterial.length >= 24 &&
    value.keyFormat === SYNC_SPACE_KEY_FORMAT &&
    value.secretEncryption === SYNC_SPACE_SECRET_ENCRYPTION
  )
}

function normalizeRemoteSyncSpace(value: unknown): RemoteSyncSpace | null {
  if (value == null) return null
  if (!isPlainRecord(value) || !isUsableSyncSpace(value as RemoteSyncSpace)) {
    throw new Error('远端同步空间信息损坏。为避免使用错误密钥覆盖或导入多端同步数据，本次同步已停止。')
  }
  return value as RemoteSyncSpace
}

function normalizeAppDataRecordManifest(value: unknown): Record<string, RemoteRecordMeta> {
  if (value == null) return {}
  if (!isPlainRecord(value)) {
    throw new Error('远端应用数据 records manifest 格式损坏。为避免把损坏状态当作空数据覆盖，本次同步已停止。')
  }

  return Object.fromEntries(
    Object.entries(value).map(([id, meta]) => {
      if (
        !isPlainRecord(meta) ||
        typeof meta.scope !== 'string' ||
        !meta.scope ||
        typeof meta.key !== 'string' ||
        !meta.key ||
        typeof meta.valueHash !== 'string' ||
        !meta.valueHash ||
        typeof meta.path !== 'string' ||
        !meta.path
      ) {
        throw new Error(
          `远端应用数据 records manifest 中的记录 ${id} 格式损坏。为避免导入或发布不完整数据，本次同步已停止。`
        )
      }

      return [
        id,
        {
          scope: meta.scope,
          key: meta.key,
          valueHash: meta.valueHash,
          updatedAt: Math.max(0, Number(meta.updatedAt) || 0),
          deletedAt: meta.deletedAt == null ? null : Math.max(0, Number(meta.deletedAt) || 0),
          deviceId: typeof meta.deviceId === 'string' && meta.deviceId ? meta.deviceId : 'unknown',
          version: Math.max(1, Number(meta.version) || 1),
          path: normalizeRemoteRelativePath(meta.path, 'Remote app data record path')
        }
      ]
    })
  )
}

function normalizeRemoteSnapshotMeta(value: unknown, id: string): RemoteSnapshotMeta {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.fileName !== 'string' ||
    !value.fileName ||
    typeof value.path !== 'string' ||
    !value.path
  ) {
    throw new Error(`远端安全快照 manifest 中的记录 ${id} 格式损坏。为避免清理或恢复错误快照，本次同步已停止。`)
  }

  return {
    id: value.id,
    fileName: value.fileName,
    path: normalizeRemoteSnapshotPath(value.path),
    byteSize: Math.max(0, Number(value.byteSize) || 0),
    checksum: typeof value.checksum === 'string' && value.checksum ? value.checksum : undefined,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : new Date(0).toISOString(),
    uploadedAt: Math.max(0, Number(value.uploadedAt) || 0),
    deviceId: typeof value.deviceId === 'string' && value.deviceId ? value.deviceId : 'unknown',
    format: 'cherry-studio-direct-backup-zip'
  }
}

function normalizeSnapshotManifest(value: unknown): Record<string, RemoteSnapshotMeta> {
  if (value == null) return {}
  if (!isPlainRecord(value)) {
    throw new Error('远端安全快照 manifest 格式损坏。为避免把损坏状态当作空快照覆盖，本次同步已停止。')
  }

  return Object.fromEntries(
    Object.entries(value).map(([id, snapshot]) => [id, normalizeRemoteSnapshotMeta(snapshot, id)])
  )
}

function normalizeLatestSnapshotMeta(value: unknown): RemoteSnapshotMeta | null {
  if (value == null) return null
  return normalizeRemoteSnapshotMeta(value, 'latestSnapshot')
}

function bufferFromRemote(value: string | Buffer | ArrayBuffer | unknown) {
  if (Buffer.isBuffer(value)) {
    return value
  }

  if (typeof value === 'string') {
    return Buffer.from(value)
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value)
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }

  return Buffer.from(String(value))
}

function safeFileSegment(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'device'
}

function snapshotFileName(deviceId: string, uploadedAt: number) {
  return `cherry-studio-pi.data-sync.${safeFileSegment(deviceId)}.${uploadedAt}.zip`
}

function joinSafetySnapshotFileName(deviceId: string, createdAt: number) {
  return `cherry-studio-pi.data-sync.join-safety.${safeFileSegment(deviceId)}.${createdAt}.zip`
}

function isManagedDataSyncTempBackupFile(fileName: string) {
  return DATA_SYNC_TEMP_BACKUP_FILE_PATTERN.test(fileName)
}

function isJoinSafetyTempBackupFile(fileName: string) {
  return DATA_SYNC_JOIN_SAFETY_FILE_PATTERN.test(fileName)
}

function getDataSyncTempBackupDir() {
  return path.join(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp', 'cherry-studio-pi', 'backup')
}

function getLegacyDataSyncTempBackupDir() {
  return path.join(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp', 'cherry-studio', 'backup')
}

function normalizeRemoteRelativePath(value: string, label = 'Remote data sync path') {
  const normalized = path.posix.normalize(value)
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..') {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

function normalizeRemoteSnapshotPath(value: string) {
  return normalizeRemoteRelativePath(value, 'Remote data snapshot path')
}

function normalizeNotesRelativePath(value: string, label = 'Notes file path') {
  const rawPath = String(value ?? '').replace(/\\/g, '/')
  if (!rawPath || !rawPath.trim() || /^[a-z]:\//i.test(rawPath)) {
    throw new Error(`${label} is invalid`)
  }

  const normalized = path.posix.normalize(rawPath.replace(/^\/+/g, ''))
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} is invalid`)
  }

  return normalized
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function notesFileRemotePath(relativePath: string, valueHash: string) {
  const pathHash = hashText(relativePath)
  return `${NOTES_REMOTE_ARTIFACT_ROOT}/files/${pathHash.slice(0, 2)}/${pathHash}/${valueHash}.bin`
}

function notesSyncStateKey(deviceId: string, relativePath: string) {
  return `${NOTES_SYNC_STATE_PREFIX}:${hashText(`${deviceId}\0${relativePath}`)}`
}

function runtimeDirectorySyncStateKey(deviceId: string, name: RuntimeDirectoryName) {
  return `${RUNTIME_DIRECTORY_SYNC_STATE_PREFIX}:${hashText(`${deviceId}\0${name}`)}`
}

function notesContentCursor(valueHash: string) {
  return `content:${valueHash}`
}

function runtimeDirectoryContentCursor(valueHash: string) {
  return `content:${valueHash}`
}

function deferredLocalSyncCursor(cursor: string) {
  return `deferred-local:${cursor}`
}

function isDeferredLocalSyncCursor(lastCursor: string | null | undefined, cursor: string | null | undefined) {
  return Boolean(cursor && lastCursor === deferredLocalSyncCursor(cursor))
}

function hasLocalCursorChangedSinceSync(lastCursor: string | null | undefined, localCursor: string | null | undefined) {
  if (!localCursor) return false
  return localCursor !== lastCursor && !isDeferredLocalSyncCursor(lastCursor, localCursor)
}

function notesRemoteCursor(meta: RemoteNotesFileMeta) {
  return meta.deletedAt ? `deleted:${meta.valueHash}:${meta.deletedAt}` : notesContentCursor(meta.valueHash)
}

function localNotesCursor(file: LocalNotesFile) {
  return notesContentCursor(file.valueHash)
}

function shouldLocalNotesFileWin(localFile: LocalNotesFile, remoteFile: RemoteNotesFileMeta) {
  if (localFile.updatedAt !== remoteFile.updatedAt) {
    return localFile.updatedAt > remoteFile.updatedAt
  }

  return localFile.valueHash >= remoteFile.valueHash
}

function isIgnoredNotesEntry(name: string) {
  return name === '.DS_Store' || name === 'Thumbs.db' || name.includes('.cherry-studio-pi-sync-download-')
}

function runtimeDirectoryBundlePath(name: RuntimeDirectoryName, valueHash: string) {
  return `${RUNTIME_DIRECTORIES_REMOTE_ROOT}/bundles/${encodePart(name)}/${valueHash}.json.gz`
}

function isIgnoredRuntimeDirectoryEntry(name: string) {
  const lowerName = name.toLowerCase()
  return (
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    lowerName.endsWith('.tmp') ||
    lowerName.endsWith('.temp') ||
    lowerName.endsWith('.log') ||
    lowerName.includes('.cherry-studio-pi-sync-download-')
  )
}

function normalizeRuntimeDirectoryName(value: string): RuntimeDirectoryName {
  return getRuntimeDirectoryPolicy(value).name
}

function getRuntimeDirectoryPolicy(value: string): RuntimeDirectoryPolicy {
  const policy = RUNTIME_DIRECTORY_POLICIES.find((item) => item.name === value)
  if (!policy) throw new Error(`远端运行时目录同步状态包含未知目录：${value}`)

  return policy
}

function runtimeDirectoryCompressedByteLimit(policy: RuntimeDirectoryPolicy) {
  return Math.max(policy.maxTotalBytes * 2, policy.maxTotalBytes + 1024 * 1024)
}

function runtimeDirectoryBundleJsonByteLimit(
  policy: RuntimeDirectoryPolicy,
  meta: Pick<RemoteRuntimeDirectoryMeta, 'byteSize' | 'fileCount'>
) {
  const expectedPayloadBytes =
    meta.byteSize > 0 && Number.isFinite(meta.byteSize) ? Math.min(meta.byteSize, policy.maxTotalBytes) : 0
  const expectedBase64Bytes = Math.ceil((expectedPayloadBytes * 4) / 3)
  const declaredFileCount = Math.min(Math.max(Number(meta.fileCount) || 1, 1), policy.maxFileCount)
  const metadataBudget = declaredFileCount * 512 + 1024 * 1024
  return Math.max(2 * 1024 * 1024, Math.min(policy.maxTotalBytes * 4, expectedBase64Bytes + metadataBudget))
}

function shouldAttemptRemoteFullSnapshotUpload() {
  return process.env[REMOTE_FULL_SNAPSHOT_OPT_IN_ENV] === '1'
}

function shouldCreateLocalJoinSafetySnapshot() {
  return process.env[LOCAL_JOIN_SAFETY_SNAPSHOT_OPT_IN_ENV] === '1'
}

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function quoteSqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function configuredDataSyncMaxRuntimeMs() {
  const parsed = Number(process.env[DATA_SYNC_MAX_RUNTIME_ENV])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DATA_SYNC_MAX_RUNTIME_MS
}

function configuredRemoteArtifactCleanupMaxFiles() {
  const parsed = Number(process.env[DATA_SYNC_CLEANUP_MAX_FILES_ENV])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMOTE_ARTIFACT_CLEANUP_MAX_FILES
}

function formatDurationZh(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`

  const totalMinutes = Math.ceil(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} 分钟`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
}

class RemoteSyncSizeLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteSyncSizeLimitError'
  }
}

function isWebDavLockedError(error: unknown) {
  return error instanceof WebDavOperationError && error.status === 423
}

function isIgnorableCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && (error.status === 405 || error.status === 409)
}

function isPreconditionCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && error.status === 412
}

function storageV2ManifestRecordEntries(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  return Object.entries(manifest?.records ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

function storageV2ManifestBlobEntries(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  return Object.entries(manifest?.blobs ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

function hasStorageV2RemoteData(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  return (
    storageV2ManifestRecordEntries(manifest).length > 0 ||
    storageV2ManifestBlobEntries(manifest).length > 0 ||
    Boolean(manifest?.secrets?.valueHash)
  )
}

function hasRuntimeDirectoriesRemoteData(manifest?: RemoteRuntimeDirectoriesManifest | null) {
  return Object.keys(manifest?.directories ?? {}).length > 0
}

function hasNotesRemoteData(manifest?: RemoteNotesManifest | null) {
  return Object.values(manifest?.files ?? {}).some((meta) => !meta.deletedAt)
}

function storageV2ManifestFingerprint(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  if (!hasStorageV2RemoteData(manifest)) return null

  return createHash('sha256')
    .update(
      JSON.stringify({
        records: storageV2ManifestRecordEntries(manifest).map(([id, meta]) => [
          id,
          meta.entityType,
          meta.valueHash,
          meta.updatedAt,
          meta.deletedAt ?? null,
          meta.version,
          meta.path
        ]),
        blobs: storageV2ManifestBlobEntries(manifest).map(([id, meta]) => [
          id,
          meta.checksum,
          meta.byteSize,
          meta.storagePath,
          meta.path,
          meta.updatedAt
        ]),
        secrets: manifest?.secrets
          ? [
              manifest.secrets.valueHash,
              manifest.secrets.secretCount,
              manifest.secrets.updatedAt,
              manifest.secrets.path,
              manifest.secrets.encryption
            ]
          : null
      })
    )
    .digest('hex')
}

function appDataArtifactFingerprint(manifest?: RemoteManifest | null) {
  const recordEntries = Object.entries(manifest?.records ?? {}).sort(([left], [right]) => left.localeCompare(right))
  const snapshotEntries = Object.entries(manifest?.snapshots ?? {}).sort(([left], [right]) => left.localeCompare(right))
  const noteEntries = Object.entries(manifest?.notes?.files ?? {})
    .filter(([, meta]) => !meta.deletedAt)
    .sort(([left], [right]) => left.localeCompare(right))
  const runtimeDirectoryEntries = Object.entries(manifest?.runtimeDirectories?.directories ?? {}).sort(
    ([left], [right]) => left.localeCompare(right)
  )
  const hasArtifacts =
    recordEntries.length > 0 ||
    snapshotEntries.length > 0 ||
    Boolean(manifest?.latestSnapshot?.path) ||
    noteEntries.length > 0 ||
    runtimeDirectoryEntries.length > 0
  if (!hasArtifacts) return null

  return hashJsonValue({
    records: recordEntries.map(([id, meta]) => [
      id,
      meta.scope,
      meta.key,
      meta.valueHash,
      meta.updatedAt,
      meta.deletedAt ?? null,
      meta.deviceId,
      meta.version,
      meta.path
    ]),
    snapshots: snapshotEntries.map(([id, meta]) => [
      id,
      meta.fileName,
      meta.path,
      meta.byteSize,
      meta.checksum ?? null,
      meta.createdAt,
      meta.uploadedAt,
      meta.deviceId,
      meta.format
    ]),
    latestSnapshot: manifest?.latestSnapshot
      ? [
          manifest.latestSnapshot.id,
          manifest.latestSnapshot.fileName,
          manifest.latestSnapshot.path,
          manifest.latestSnapshot.byteSize,
          manifest.latestSnapshot.checksum ?? null,
          manifest.latestSnapshot.createdAt,
          manifest.latestSnapshot.uploadedAt,
          manifest.latestSnapshot.deviceId,
          manifest.latestSnapshot.format
        ]
      : null,
    notes: noteEntries.map(([id, meta]) => [
      id,
      meta.relativePath,
      meta.valueHash,
      meta.byteSize,
      meta.updatedAt,
      meta.deviceId,
      meta.path
    ]),
    runtimeDirectories: runtimeDirectoryEntries.map(([id, meta]) => [
      id,
      meta.name,
      meta.valueHash,
      meta.byteSize,
      meta.compressedByteSize,
      meta.fileCount,
      meta.updatedAt,
      meta.deviceId,
      meta.path
    ])
  })
}

function remoteManifestPublishFingerprint(manifest: RemoteManifest) {
  return hashJsonValue({
    ...manifest,
    generation: 0,
    updatedAt: 0
  })
}

function isRemoteArtifactCleanupDue(lastCleanupAt: unknown, now: number) {
  const timestamp = Number(lastCleanupAt ?? 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return true
  if (timestamp > now + REMOTE_ARTIFACT_CLEANUP_INTERVAL_MS) return true
  return now - timestamp >= REMOTE_ARTIFACT_CLEANUP_INTERVAL_MS
}

function getStorageV2ManifestEntityTypes(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  return new Set(storageV2ManifestRecordEntries(manifest).map(([, meta]) => meta.entityType))
}

function collectWebDavLockTokens(value: unknown, tokens = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectWebDavLockTokens(item, tokens)
    }
    return tokens
  }

  if (!value || typeof value !== 'object') return tokens

  const source = value as Record<string, unknown>
  const lockToken = source.locktoken
  if (lockToken && typeof lockToken === 'object') {
    const href = (lockToken as Record<string, unknown>).href
    if (typeof href === 'string' && href.trim()) {
      tokens.add(href.trim())
    }
  }

  for (const child of Object.values(source)) {
    collectWebDavLockTokens(child, tokens)
  }

  return tokens
}

export class AppDataSyncService {
  private static instance: AppDataSyncService | null = null
  private readonly backupManager: BackupManager
  private readonly runtimeId = `${process.pid}-${randomUUID()}`
  private syncInFlight: Promise<DataSyncSummary> | null = null
  private syncBackgroundInFlight: Promise<DataSyncSummary> | null = null
  private syncRunContext: SyncRunContext | null = null
  private syncStartedAt: number | null = null
  private pendingFailureSafetySnapshot: DataSyncFailureSafetySnapshot | null = null

  constructor(backupManager = new BackupManager()) {
    this.backupManager = backupManager
  }

  static getInstance() {
    if (!AppDataSyncService.instance) {
      AppDataSyncService.instance = new AppDataSyncService()
    }

    return AppDataSyncService.instance
  }

  private createSyncRunContext(): SyncRunContext {
    const startedAt = Date.now()
    const maxRuntimeMs = configuredDataSyncMaxRuntimeMs()
    return {
      startedAt,
      deadlineAt: startedAt + maxRuntimeMs,
      maxRuntimeMs,
      aborted: false,
      abortReason: null
    }
  }

  private formatSyncDeadlineExceededMessage(context: SyncRunContext, stage?: string) {
    const stageText = stage ? `（阶段：${stage}）` : ''
    return `同步超过 ${formatDurationZh(
      context.maxRuntimeMs
    )}仍未完成${stageText}。为避免远端锁被长时间占用，本次同步已停止；请稍后重试，如果再次出现请检查 WebDAV 服务响应或本机数据文件是否异常。`
  }

  private abortSyncRun(context: SyncRunContext, reason: string) {
    context.aborted = true
    context.abortReason = reason
    return new Error(reason)
  }

  private assertSyncRunActive(context: SyncRunContext, stage?: string) {
    if (context.aborted) {
      throw new Error(context.abortReason ?? this.formatSyncDeadlineExceededMessage(context, stage))
    }

    if (Date.now() >= context.deadlineAt) {
      throw this.abortSyncRun(context, this.formatSyncDeadlineExceededMessage(context, stage))
    }
  }

  private withSyncRunDeadline<T>(promise: Promise<T>, context: SyncRunContext): Promise<T> {
    const remainingMs = Math.max(0, context.deadlineAt - Date.now())
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(this.abortSyncRun(context, this.formatSyncDeadlineExceededMessage(context)))
      }, remainingMs)
      if (typeof timeoutId === 'object' && timeoutId && 'unref' in timeoutId && typeof timeoutId.unref === 'function') {
        timeoutId.unref()
      }
    })

    promise.catch((error) => {
      if (context.aborted) {
        logger.warn('Background data sync stopped after the run deadline', error as Error)
      }
    })

    return Promise.race([promise, timeout]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })
  }

  private normalizeSyncWebDavConfig(config: WebDavConfig) {
    return normalizeWebDavConfig(config, {
      defaultPath: DATA_SYNC_REMOTE_ROOT,
      requireCredentials: true
    })
  }

  private clearSyncStartedAtIfIdle() {
    if (!this.syncInFlight && !this.syncBackgroundInFlight) {
      this.syncStartedAt = null
      this.syncRunContext = null
    }
  }

  private clearExpiredInFlightSync(now = Date.now()) {
    const context = this.syncRunContext
    if (!context || (!this.syncInFlight && !this.syncBackgroundInFlight)) return false
    if (!context.aborted && now < context.deadlineAt) return false

    const reason = context.abortReason ?? this.formatSyncDeadlineExceededMessage(context)
    if (!context.aborted) {
      this.abortSyncRun(context, reason)
    }

    logger.warn('Clearing expired local data sync in-flight state', {
      startedAt: context.startedAt,
      deadlineAt: context.deadlineAt,
      reason
    })
    this.syncInFlight = null
    this.syncBackgroundInFlight = null
    this.syncStartedAt = null
    this.syncRunContext = null
    return true
  }

  private createWebDavClient(config: WebDavConfig) {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)
    const webdavHost = normalizeWebDavHost(normalizedConfig.webdavHost)
    const basePath = normalizeBasePath(normalizedConfig.webdavPath)

    logger.info('Creating data sync WebDAV client', {
      host: redactWebDavHostForLog(webdavHost),
      basePath,
      hasUsername: Boolean(normalizedConfig.webdavUser),
      hasPassword: Boolean(normalizedConfig.webdavPass)
    })

    const client = createClient(webdavHost, {
      username: normalizedConfig.webdavUser,
      password: normalizedConfig.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

    return {
      client,
      basePath
    }
  }

  private createRawWebDavClient(config: WebDavConfig) {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)
    const webdavHost = normalizeWebDavHost(normalizedConfig.webdavHost)

    logger.info('Creating data sync WebDAV directory client', {
      host: redactWebDavHostForLog(webdavHost),
      path: normalizedConfig.webdavPath,
      hasUsername: Boolean(normalizedConfig.webdavUser),
      hasPassword: Boolean(normalizedConfig.webdavPass)
    })

    return createClient(webdavHost, {
      username: normalizedConfig.webdavUser,
      password: normalizedConfig.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })
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
      if (isPreconditionCreateDirectoryError(error)) {
        const existsAfterFailure = await runWebDavOperation(
          `checking remote directory ${dirPath} after create precondition failure`,
          () => client.exists(dirPath),
          { logger }
        ).catch(() => false)
        if (existsAfterFailure) {
          logger.warn(`Remote directory ${dirPath} exists after create precondition failure`, error as Error)
          return
        }
      }
      throw error
    }
  }

  private async assertProbeWriteAccess(client: WebDAVClient, probePath: string, label: string) {
    await runWebDavOperation(
      `writing ${label} ${probePath}`,
      () => client.putFileContents(probePath, 'ok', { overwrite: true }),
      { logger }
    )

    const maybeDeleteFile = (client as WebDAVClient & { deleteFile?: (filePath: string) => Promise<void> }).deleteFile
    if (typeof maybeDeleteFile !== 'function') {
      throw new Error(
        '当前 WebDAV 客户端不支持删除远端文件，无法保证同步目录文件数量收敛。请更换 WebDAV 服务或升级客户端后重试。'
      )
    }

    await runWebDavOperation(`deleting ${label} ${probePath}`, () => maybeDeleteFile.call(client, probePath), {
      logger
    })
  }

  private async assertWriteAccess(client: WebDAVClient, basePath: string) {
    const probePath = path.posix.join(basePath, `.cherry-studio-pi-write-test-${Date.now()}.tmp`)
    await this.assertProbeWriteAccess(client, probePath, 'remote sync probe')
  }

  private async assertStorageV2WriteAccess(client: WebDAVClient, basePath: string) {
    for (const relativeProbeDir of STORAGE_V2_WRITE_ACCESS_PROBE_DIRS) {
      const storageProbeDir = path.posix.join(basePath, relativeProbeDir)
      await this.ensureDirectory(client, storageProbeDir)
      const probePath = path.posix.join(storageProbeDir, `.cherry-studio-pi-storage-write-test-${Date.now()}.tmp`)
      await this.assertProbeWriteAccess(client, probePath, `Storage v2 sync probe ${relativeProbeDir}`)
    }
  }

  private async getRemoteFileByteSize(client: WebDAVClient, filePath: string): Promise<number | null> {
    const stat = (client as WebDAVClient & { stat?: (targetPath: string) => Promise<unknown> }).stat
    if (typeof stat !== 'function') return null

    try {
      const result = await runWebDavOperation(
        `checking remote file size ${filePath}`,
        () => stat.call(client, filePath),
        {
          logger
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
    maxBytes: number
  ) {
    const byteSize = await this.getRemoteFileByteSize(client, filePath)
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
    options: { throwOnInvalidJson?: boolean; maxBytes?: number; label?: string } = {}
  ): Promise<T | null> {
    try {
      if (!(await runWebDavOperation(`checking remote json ${filePath}`, () => client.exists(filePath), { logger }))) {
        return null
      }

      const label = options.label ?? '远端同步 JSON'
      if (options.maxBytes) {
        await this.assertRemoteFileWithinByteLimit(client, filePath, label, options.maxBytes)
      }
      const contents = await runWebDavOperation(
        `reading remote json ${filePath}`,
        () => client.getFileContents(filePath, { format: 'binary' }),
        { logger }
      )
      const buffer = bufferFromRemote(contents)
      if (options.maxBytes) {
        this.assertRemoteBufferWithinByteLimit(buffer, label, options.maxBytes)
      }
      try {
        return JSON.parse(buffer.toString('utf8')) as T
      } catch (error) {
        if (options.throwOnInvalidJson) {
          throw new Error(`Remote sync metadata is corrupted: ${filePath}`, { cause: error })
        }
        throw error
      }
    } catch (error) {
      if (error instanceof RemoteSyncSizeLimitError) {
        throw error
      }
      if (error instanceof WebDavOperationError && error.transient) {
        throw error
      }

      if (options.throwOnInvalidJson) {
        throw error
      }

      logger.warn(`Failed to read remote json ${filePath}`, error as Error)
      return null
    }
  }

  private async writeJson(client: WebDAVClient, filePath: string, data: unknown) {
    await this.ensureDirectory(client, path.posix.dirname(filePath))
    await writeWebDavJsonAtomically(client, filePath, data, {
      logger,
      operation: 'remote sync json',
      overwrite: true
    })
  }

  private async removeRemoteFile(client: WebDAVClient, filePath: string) {
    const deleteFile = (client as WebDAVClient & { deleteFile?: (targetPath: string) => Promise<void> }).deleteFile
    if (typeof deleteFile !== 'function') {
      throw new Error(
        '当前 WebDAV 客户端不支持删除远端文件，无法清理旧同步文件。请更换 WebDAV 服务或升级客户端后重试。'
      )
    }

    await runWebDavOperation(`deleting remote file ${filePath}`, () => deleteFile.call(client, filePath), {
      logger
    }).catch((error) => {
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
    referenced: ReadonlySet<string>
  ) {
    if (this.hasReferencedPathUnderRoot(referenced, rootPath)) return false

    try {
      await this.removeRemoteFile(client, rootPath)
      return true
    } catch (error) {
      if (error instanceof WebDavOperationError && error.transient) {
        throw error
      }

      logger.warn(
        `Failed to prune stale WebDAV artifact directory ${rootPath}; falling back to file cleanup`,
        error as Error
      )
      return false
    }
  }

  private assertRemoteArtifactCleanupFileBudget(counter: { files: number }, rootPath: string) {
    const maxFiles = configuredRemoteArtifactCleanupMaxFiles()
    if (counter.files <= maxFiles) return

    throw new Error(
      `远端同步目录旧文件数量过多（${rootPath} 已超过 ${maxFiles} 个）。为避免 WebDAV 清理阶段长时间卡住，本次同步已停止；请清理远端目录中的异常旧文件后重试。`
    )
  }

  private async listRemoteFilesRecursive(
    client: WebDAVClient,
    dirPath: string,
    options: { context?: SyncRunContext; counter?: { files: number }; rootPath?: string } = {}
  ): Promise<string[]> {
    options.context && this.assertSyncRunActive(options.context, '清理远端旧文件')
    try {
      const exists = await runWebDavOperation(
        `checking remote artifact directory ${dirPath}`,
        () => client.exists(dirPath),
        {
          logger
        }
      )
      if (!exists) return []
    } catch (error) {
      if (error instanceof WebDavOperationError && error.status === 404) return []
      throw error
    }

    const contents = await runWebDavOperation(
      `listing remote artifact directory ${dirPath}`,
      () => client.getDirectoryContents(dirPath),
      { logger }
    )
    const entries = normalizeDirectoryContents(contents)
    const files: string[] = []
    const normalizedDirPath = path.posix.normalize(dirPath).replace(/\/+$/g, '')
    const counter = options.counter ?? { files: 0 }
    const rootPath = options.rootPath ?? normalizedDirPath

    for (const entry of entries) {
      options.context && this.assertSyncRunActive(options.context, '清理远端旧文件')
      const filename = entry.filename || path.posix.join(dirPath, entry.basename || '')
      if (!filename || filename === dirPath) continue
      const normalizedFilename = path.posix.normalize(filename)
      if (normalizedFilename !== normalizedDirPath && !normalizedFilename.startsWith(`${normalizedDirPath}/`)) continue

      if (entry.type === 'directory') {
        files.push(
          ...(await this.listRemoteFilesRecursive(client, normalizedFilename, {
            context: options.context,
            counter,
            rootPath
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

  private async pruneRemoteAppDataArtifacts(
    client: WebDAVClient,
    basePath: string,
    manifest: RemoteManifest,
    context?: SyncRunContext
  ) {
    const referenced = new Set<string>()
    const addReferencedPath = (relativePath: string | null | undefined) => {
      if (!relativePath) return
      referenced.add(
        path.posix.join(basePath, normalizeRemoteRelativePath(relativePath, 'Remote app data artifact path'))
      )
    }

    for (const meta of Object.values(manifest.records ?? {})) {
      addReferencedPath(meta.path)
    }
    for (const snapshot of Object.values(manifest.snapshots ?? {})) {
      addReferencedPath(snapshot.path)
    }
    addReferencedPath(manifest.latestSnapshot?.path)
    for (const note of Object.values(manifest.notes?.files ?? {})) {
      if (!note.deletedAt) {
        addReferencedPath(note.path)
      }
    }
    for (const directory of Object.values(manifest.runtimeDirectories?.directories ?? {})) {
      addReferencedPath(directory.path)
    }

    for (const root of ['records', 'backups', NOTES_REMOTE_ARTIFACT_ROOT, RUNTIME_DIRECTORIES_REMOTE_ROOT]) {
      context && this.assertSyncRunActive(context, '清理远端应用数据旧文件')
      const rootPath = path.posix.join(basePath, root)
      if (await this.pruneRemoteArtifactRootIfUnreferenced(client, rootPath, referenced)) {
        continue
      }

      const files = await this.listRemoteFilesRecursive(client, rootPath, { context })
      for (const filePath of files) {
        context && this.assertSyncRunActive(context, '清理远端应用数据旧文件')
        if (referenced.has(filePath)) continue
        await this.removeRemoteFile(client, filePath)
      }
    }
  }

  private async pruneRemoteRootTempArtifacts(client: WebDAVClient, basePath: string, context?: SyncRunContext) {
    context && this.assertSyncRunActive(context, '清理远端临时文件')
    const contents = await runWebDavOperation(
      `listing remote sync root temporary artifacts ${basePath}`,
      () => client.getDirectoryContents(basePath),
      { logger }
    )
    const entries = normalizeDirectoryContents(contents)
    if (entries.length > configuredRemoteArtifactCleanupMaxFiles()) {
      throw new Error(
        `远端同步根目录文件数量过多（${entries.length} 个，限制 ${configuredRemoteArtifactCleanupMaxFiles()} 个）。为避免 WebDAV 清理阶段长时间卡住，本次同步已停止；请清理远端目录中的异常临时文件后重试。`
      )
    }

    for (const entry of entries) {
      context && this.assertSyncRunActive(context, '清理远端临时文件')
      if (entry.type === 'directory') continue

      const filename = entry.filename || path.posix.join(basePath, entry.basename || '')
      const basename = entry.basename || path.posix.basename(filename)
      if (!filename || !basename) continue

      const isTemporaryJson = basename.startsWith('.tmp-') && basename.endsWith('.json')
      const isLegacyWriteProbe =
        basename.startsWith('.cherry-studio-pi-write-test-') ||
        basename.startsWith('.cherry-studio-pi-storage-write-test-')
      if (!isTemporaryJson && !isLegacyWriteProbe) continue

      await this.removeRemoteFile(client, path.posix.normalize(filename))
    }
  }

  private normalizeRemoteLock(lock: RemoteSyncLock | null): RemoteSyncLock | null {
    if (!lock || lock.version !== 1 || !lock.ownerId || !lock.token) return null
    const createdAt = Number(lock.createdAt) || 0
    const updatedAt = Number(lock.updatedAt) || createdAt
    const leaseMs = Number(lock.leaseMs) || REMOTE_SYNC_LOCK_TTL_MS
    const deadlineAt = Number(lock.deadlineAt) || undefined
    const maxRuntimeMs = Number(lock.maxRuntimeMs) || undefined

    return {
      version: 1,
      ownerId: String(lock.ownerId),
      token: String(lock.token),
      createdAt,
      updatedAt,
      expiresAt: Number(lock.expiresAt) || 0,
      leaseMs,
      deadlineAt,
      maxRuntimeMs,
      runtimeId: typeof lock.runtimeId === 'string' ? lock.runtimeId : undefined,
      app: 'cherry-studio-pi',
      reason: 'data-sync'
    }
  }

  private isRemoteLockExpired(lock: RemoteSyncLock, now = Date.now()) {
    return !lock.expiresAt || lock.expiresAt <= now
  }

  private isRemoteLockHeartbeatStale(lock: RemoteSyncLock, now = Date.now()) {
    const lastActivityAt = lock.updatedAt || lock.createdAt
    return lastActivityAt > 0 && now - lastActivityAt >= REMOTE_SYNC_LOCK_STALE_HEARTBEAT_MS
  }

  private getRemoteLockDeadlineAt(lock: RemoteSyncLock) {
    const deadlineAt = Number(lock.deadlineAt) || 0
    if (deadlineAt > 0) return deadlineAt

    const createdAt = Number(lock.createdAt) || 0
    if (createdAt <= 0) return 0

    const maxRuntimeMs = Number(lock.maxRuntimeMs) || configuredDataSyncMaxRuntimeMs()
    return createdAt + Math.max(1, maxRuntimeMs)
  }

  private isRemoteLockRuntimeExceeded(lock: RemoteSyncLock, now = Date.now()) {
    const deadlineAt = this.getRemoteLockDeadlineAt(lock)
    return deadlineAt > 0 && deadlineAt <= now
  }

  private shouldReclaimRemoteLock(lock: RemoteSyncLock, ownerId: string, now = Date.now(), currentToken?: string) {
    if (currentToken && lock.ownerId === ownerId && lock.token === currentToken) return false
    if (
      this.isRemoteLockExpired(lock, now) ||
      this.isRemoteLockHeartbeatStale(lock, now) ||
      this.isRemoteLockRuntimeExceeded(lock, now)
    ) {
      return true
    }

    // Legacy same-device locks did not include runtimeId, so they can be reclaimed
    // after a restart. Fresh locks from the current lock format must stay blocking:
    // a second app process or a timed-out background run may still be mutating data.
    return lock.ownerId === ownerId && !lock.runtimeId
  }

  private formatRemoteLockMessage(lock: RemoteSyncLock, ownerId?: string) {
    const createdAt = lock.createdAt ? new Date(lock.createdAt).toLocaleString('zh-CN') : '未知时间'
    const updatedAt = lock.updatedAt ? new Date(lock.updatedAt).toLocaleString('zh-CN') : createdAt
    const expiresAt = lock.expiresAt ? new Date(lock.expiresAt).toLocaleString('zh-CN') : '未知时间'
    const deadlineAt = this.getRemoteLockDeadlineAt(lock)
    const deadlineText = deadlineAt ? new Date(deadlineAt).toLocaleString('zh-CN') : '未知时间'
    if (ownerId && lock.ownerId === ownerId) {
      return `当前设备已有一次同步正在占用这个 WebDAV 目录（开始：${createdAt}，最近活动：${updatedAt}，锁过期：${expiresAt}，最长占用到：${deadlineText}）。请等待它完成后再试；如果长时间卡住，软件会在最长占用时间后自动接管。`
    }
    return `另一台设备正在同步这个 WebDAV 目录（设备：${lock.ownerId}，开始：${createdAt}，最近活动：${updatedAt}，锁过期：${expiresAt}，最长占用到：${deadlineText}）。请等待它完成后再试；如果那台设备长时间卡住，软件会在最长占用时间后自动接管。`
  }

  private async readRemoteLock(client: WebDAVClient, lockPath: string) {
    try {
      return this.normalizeRemoteLock(
        await this.readJson<RemoteSyncLock>(client, lockPath, {
          throwOnInvalidJson: true,
          maxBytes: REMOTE_SYNC_LOCK_MAX_BYTES,
          label: '远端同步锁'
        })
      )
    } catch (error) {
      throw new Error(`远端同步锁读取失败。为避免破坏远端数据，本次同步已停止：${errorMessage(error)}`)
    }
  }

  private async discoverWebDavLockTokens(client: WebDAVClient, remotePath: string) {
    const customRequest = client.customRequest
    if (typeof customRequest !== 'function') return []

    try {
      const response = await runWebDavOperation(
        `discovering remote WebDAV locks ${remotePath}`,
        () =>
          customRequest.call(client, remotePath, {
            method: 'PROPFIND',
            headers: {
              Accept: 'application/xml,text/xml',
              'Content-Type': 'application/xml; charset=utf-8',
              Depth: '0'
            },
            data:
              '<?xml version="1.0" encoding="utf-8"?>' +
              '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>'
          }),
        { logger }
      )
      const xml = await response.text()
      const parser = new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseTagValue: false,
        trimValues: true
      })
      return [...collectWebDavLockTokens(parser.parse(xml))]
    } catch (error) {
      if (error instanceof WebDavOperationError && error.status === 404) return []
      logger.warn(`Failed to discover remote WebDAV locks ${remotePath}`, error as Error)
      return []
    }
  }

  private normalizeWebDavLockToken(token: string) {
    return token.trim().replace(/^<|>$/g, '')
  }

  private async unlockRemotePathWithToken(client: WebDAVClient, remotePath: string, token: string) {
    const normalizedToken = this.normalizeWebDavLockToken(token)
    const candidates = [normalizedToken, `<${normalizedToken}>`]

    for (const candidate of candidates) {
      try {
        await runWebDavOperation(
          `unlocking discovered remote WebDAV lock ${remotePath}`,
          () => client.unlock(remotePath, candidate),
          { logger }
        )
        return true
      } catch (error) {
        logger.warn(`Failed to unlock discovered remote WebDAV lock ${remotePath}`, error as Error)
      }
    }

    return false
  }

  private async unlockDiscoveredWebDavLocks(client: WebDAVClient, remotePath: string) {
    const tokens = await this.discoverWebDavLockTokens(client, remotePath)
    let unlocked = false
    for (const token of tokens) {
      unlocked = (await this.unlockRemotePathWithToken(client, remotePath, token)) || unlocked
    }
    return unlocked
  }

  private async unlockDiscoveredWebDavLocksForPath(client: WebDAVClient, targetPath: string) {
    const candidates = new Set<string>()
    let current = path.posix.normalize(targetPath)
    for (let depth = 0; depth < 4 && current && current !== '/'; depth += 1) {
      candidates.add(current)
      current = path.posix.dirname(current)
    }

    for (const candidate of candidates) {
      if (await this.unlockDiscoveredWebDavLocks(client, candidate)) {
        return true
      }
    }

    return false
  }

  private async removeReclaimableRemoteLock(
    client: WebDAVClient,
    lockPath: string,
    lock: RemoteSyncLock | null,
    ownerId: string,
    options: { bestEffort?: boolean } = {}
  ) {
    if (lock) {
      logger.warn('Removing reclaimable remote data sync lock', {
        ownerId: lock.ownerId,
        currentOwnerId: ownerId,
        createdAt: lock.createdAt,
        updatedAt: lock.updatedAt,
        expiresAt: lock.expiresAt,
        deadlineAt: this.getRemoteLockDeadlineAt(lock)
      })
    } else {
      logger.warn('Removing invalid remote data sync lock')
    }
    try {
      await this.removeRemoteFile(client, lockPath)
    } catch (error) {
      if (isWebDavLockedError(error) && (await this.unlockDiscoveredWebDavLocksForPath(client, lockPath))) {
        try {
          await this.removeRemoteFile(client, lockPath)
          return
        } catch (retryError) {
          logger.warn(
            'Failed to remove reclaimable remote data sync lock after unlocking WebDAV path',
            retryError as Error
          )
        }
      }
      if (options.bestEffort) {
        logger.warn('Failed to remove reclaimable remote data sync lock; ignoring stale claim', error as Error)
        return
      }
      throw error
    }
  }

  private getLegacyRemoteLockPath(basePath: string) {
    return path.posix.join(basePath, LEGACY_REMOTE_SYNC_LOCK_FILE)
  }

  private getRemoteLockDir(basePath: string) {
    return path.posix.join(basePath, REMOTE_SYNC_LOCK_DIR)
  }

  private getRemoteLockClaimPath(basePath: string, ownerId: string, token: string) {
    return path.posix.join(
      this.getRemoteLockDir(basePath),
      `${safeFileSegment(ownerId)}.${safeFileSegment(token)}.json`
    )
  }

  private async ensureRemoteLockDirectory(client: WebDAVClient, basePath: string) {
    const lockDir = this.getRemoteLockDir(basePath)
    try {
      await this.ensureDirectory(client, lockDir)
      return
    } catch (error) {
      if (!isWebDavLockedError(error) || !(await this.unlockDiscoveredWebDavLocksForPath(client, lockDir))) {
        throw error
      }
      await this.ensureDirectory(client, lockDir)
    }
  }

  private async readRemoteLockIfExists(client: WebDAVClient, lockPath: string) {
    const hasLock = await runWebDavOperation(
      `checking remote data sync lock ${lockPath}`,
      () => client.exists(lockPath),
      {
        logger
      }
    )
    if (!hasLock) return { exists: false, lock: null }

    return {
      exists: true,
      lock: await this.readRemoteLock(client, lockPath)
    }
  }

  private async listRemoteLockClaims(client: WebDAVClient, basePath: string) {
    const lockDir = this.getRemoteLockDir(basePath)
    const exists = await runWebDavOperation(`checking remote data sync lock directory ${lockDir}`, () =>
      client.exists(lockDir)
    ).catch((error) => {
      if (error instanceof WebDavOperationError && error.status === 404) return false
      throw error
    })
    if (!exists) return []

    const contents = await runWebDavOperation(
      `listing remote data sync lock directory ${lockDir}`,
      () => client.getDirectoryContents(lockDir),
      { logger }
    )
    const entries = normalizeDirectoryContents(contents)
    const fileEntries = entries.filter((entry) => entry.type !== 'directory')
    if (fileEntries.length > REMOTE_SYNC_LOCK_CLAIM_MAX_COUNT) {
      throw new Error(
        `远端同步锁目录异常：发现 ${fileEntries.length} 个锁文件，限制 ${REMOTE_SYNC_LOCK_CLAIM_MAX_COUNT} 个。为避免同步在锁检查阶段长时间卡住，本次同步已停止；如果确认没有其他设备正在同步，请清理远端 ${REMOTE_SYNC_LOCK_DIR} 目录后重试。`
      )
    }
    const claims: RemoteSyncLockEntry[] = []
    const normalizedLockDir = path.posix.normalize(lockDir).replace(/\/+$/g, '')

    for (const entry of fileEntries) {
      const filename = entry.filename || path.posix.join(lockDir, entry.basename || '')
      if (!filename || !filename.endsWith('.json')) continue
      const lockPath = path.posix.normalize(filename)
      if (!lockPath.startsWith(`${normalizedLockDir}/`)) continue
      const lock = await this.readRemoteLock(client, lockPath)
      if (lock) {
        claims.push({ path: lockPath, lock })
      } else {
        await this.removeReclaimableRemoteLock(client, lockPath, null, 'unknown', { bestEffort: true })
      }
    }

    return claims
  }

  private async listBlockingRemoteLocks(
    client: WebDAVClient,
    basePath: string,
    ownerId: string,
    options: { currentToken?: string } = {}
  ) {
    const blockingLocks: RemoteSyncLockEntry[] = []
    const now = Date.now()
    const legacyLockPath = this.getLegacyRemoteLockPath(basePath)
    const legacyLock = await this.readRemoteLockIfExists(client, legacyLockPath)
    if (legacyLock.exists) {
      if (!legacyLock.lock) {
        await this.removeReclaimableRemoteLock(client, legacyLockPath, null, ownerId, { bestEffort: true })
      } else if (this.shouldReclaimRemoteLock(legacyLock.lock, ownerId, now, options.currentToken)) {
        await this.removeReclaimableRemoteLock(client, legacyLockPath, legacyLock.lock, ownerId, { bestEffort: true })
      } else {
        blockingLocks.push({ path: legacyLockPath, lock: legacyLock.lock })
      }
    }

    for (const claim of await this.listRemoteLockClaims(client, basePath)) {
      if (options.currentToken && claim.lock.ownerId === ownerId && claim.lock.token === options.currentToken) {
        continue
      }
      if (this.shouldReclaimRemoteLock(claim.lock, ownerId, now, options.currentToken)) {
        await this.removeReclaimableRemoteLock(client, claim.path, claim.lock, ownerId, { bestEffort: true })
      } else {
        blockingLocks.push(claim)
      }
    }

    return blockingLocks
  }

  private async assertRemoteLockAvailable(client: WebDAVClient, basePath: string, ownerId: string) {
    const blockingLocks = await this.listBlockingRemoteLocks(client, basePath, ownerId)
    if (blockingLocks.length === 0) return

    throw new Error(this.formatRemoteLockMessage(blockingLocks[0].lock, ownerId))
  }

  private formatNativeWebDavLockHeader(token: string) {
    const normalizedToken = token.replace(/^<|>$/g, '')
    return `(<${normalizedToken}>)`
  }

  private async acquireNativeWebDavLock(
    client: WebDAVClient,
    basePath: string,
    ownerId: string
  ): Promise<RemoteSyncLockHandle | null> {
    const lockMethod = client.lock
    if (typeof lockMethod !== 'function') return null

    try {
      const lock = await runWebDavOperation(
        `locking remote data sync directory ${basePath}`,
        () => lockMethod.call(client, basePath, { timeout: `Second-${Math.ceil(REMOTE_SYNC_LOCK_TTL_MS / 1000)}` }),
        { logger }
      )

      if (!lock?.token) return null

      const previousHeaders = typeof client.getHeaders === 'function' ? client.getHeaders() : null
      if (typeof client.setHeaders === 'function') {
        client.setHeaders({
          ...previousHeaders,
          If: this.formatNativeWebDavLockHeader(lock.token)
        })
      }

      return {
        type: 'webdav',
        path: basePath,
        ownerId,
        token: lock.token,
        runtimeId: this.runtimeId,
        previousHeaders
      }
    } catch (error) {
      if (error instanceof WebDavOperationError && error.transient) throw error
      if (error instanceof WebDavOperationError && error.status === 423) {
        throw new Error('另一台设备正在同步这个 WebDAV 目录。请等待它完成后再试。')
      }

      if (
        error instanceof WebDavOperationError &&
        error.status &&
        NATIVE_WEB_DAV_LOCK_UNSUPPORTED_STATUSES.has(error.status)
      ) {
        return null
      }

      logger.warn('Native WebDAV directory lock is unavailable; falling back to file lock', error as Error)
      return null
    }
  }

  private async acquireRemoteLock(
    client: WebDAVClient,
    basePath: string,
    ownerId: string,
    context: SyncRunContext
  ): Promise<RemoteSyncLockHandle> {
    if (process.env[NATIVE_WEB_DAV_LOCK_OPT_IN_ENV] === '1') {
      const nativeLock = await this.acquireNativeWebDavLock(client, basePath, ownerId)
      if (nativeLock) return nativeLock
    }

    const token = randomUUID()
    const lockPath = this.getRemoteLockClaimPath(basePath, ownerId, token)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.assertSyncRunActive(context, '创建远端同步锁')
      await this.assertRemoteLockAvailable(client, basePath, ownerId)
      await this.ensureRemoteLockDirectory(client, basePath)
      const now = Date.now()
      const lock: RemoteSyncLock = {
        version: 1,
        ownerId,
        token,
        createdAt: now,
        updatedAt: now,
        expiresAt: Math.min(now + REMOTE_SYNC_LOCK_TTL_MS, context.deadlineAt),
        leaseMs: REMOTE_SYNC_LOCK_TTL_MS,
        deadlineAt: context.deadlineAt,
        maxRuntimeMs: context.maxRuntimeMs,
        runtimeId: this.runtimeId,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      }

      let created = false
      try {
        created = await runWebDavOperation(
          `creating remote data sync lock claim ${lockPath}`,
          () => client.putFileContents(lockPath, JSON.stringify(lock, null, 2), { overwrite: false }),
          { logger }
        )
      } catch (error) {
        if (error instanceof WebDavOperationError && error.transient) throw error
        if (isWebDavLockedError(error) && (await this.unlockDiscoveredWebDavLocksForPath(client, lockPath))) {
          continue
        }
        if (error instanceof WebDavOperationError && error.status && ![409, 412, 423].includes(error.status)) {
          throw error
        }
        logger.warn('Failed to create remote data sync lock; inspecting existing lock', error as Error)
      }

      if (created) {
        const remoteLock = await this.readRemoteLock(client, lockPath)
        if (remoteLock?.token === token && remoteLock.ownerId === ownerId) {
          const blockingLocks = await this.listBlockingRemoteLocks(client, basePath, ownerId, { currentToken: token })
          if (blockingLocks.length > 0) {
            await this.removeRemoteFile(client, lockPath).catch((error) => {
              logger.warn('Failed to remove local remote data sync lock claim after losing acquisition race', error)
            })
            throw new Error(this.formatRemoteLockMessage(blockingLocks[0].lock, ownerId))
          }

          return { type: 'file', path: lockPath, ownerId, token, runtimeId: this.runtimeId }
        }
      }

      const existingLock = await this.readRemoteLock(client, lockPath)
      if (!existingLock) {
        await this.removeReclaimableRemoteLock(client, lockPath, null, ownerId, { bestEffort: true }).catch((error) => {
          logger.warn('Failed to remove invalid remote data sync lock before retrying', error as Error)
        })
        continue
      }

      if (!this.shouldReclaimRemoteLock(existingLock, ownerId, now, token)) {
        throw new Error(this.formatRemoteLockMessage(existingLock, ownerId))
      }

      await this.removeReclaimableRemoteLock(client, lockPath, existingLock, ownerId, { bestEffort: true })
    }

    throw new Error('无法创建远端同步锁。为避免多设备同时写入导致数据丢失，本次同步已停止，请稍后重试。')
  }

  private async releaseRemoteLock(client: WebDAVClient, lock: RemoteSyncLockHandle | null) {
    if (!lock) return

    if (lock.type === 'webdav') {
      try {
        await runWebDavOperation(
          `unlocking remote data sync directory ${lock.path}`,
          () => client.unlock(lock.path, lock.token),
          {
            logger
          }
        )
      } catch (error) {
        logger.warn('Failed to release native WebDAV data sync lock', error as Error)
      } finally {
        if (typeof client.setHeaders === 'function' && lock.previousHeaders) {
          client.setHeaders(lock.previousHeaders)
        }
      }
      return
    }

    try {
      const remoteLock = await this.readRemoteLock(client, lock.path)
      if (!remoteLock) return
      if (remoteLock.token !== lock.token || remoteLock.ownerId !== lock.ownerId) {
        logger.warn('Remote data sync lock owner changed before release; leaving it untouched', remoteLock)
        return
      }
      await this.removeRemoteFile(client, lock.path)
    } catch (error) {
      logger.warn('Failed to release remote data sync lock', error as Error)
    }
  }

  private startRemoteLockRenewal(client: WebDAVClient, lock: RemoteSyncLockHandle | null, context: SyncRunContext) {
    let stopped = false
    let renewalError: unknown = null
    let interval: ReturnType<typeof setInterval> | null = null
    if (!lock || lock.type !== 'file') {
      return {
        stop: () => undefined,
        getError: () => renewalError
      }
    }

    const renew = async () => {
      try {
        this.assertSyncRunActive(context, '续租远端同步锁')
        const remoteLock = await this.readRemoteLock(client, lock.path)
        if (!remoteLock || remoteLock.token !== lock.token || remoteLock.ownerId !== lock.ownerId) {
          throw new Error('远端同步锁已被其他设备接管')
        }

        const now = Date.now()
        const expiresAt = Math.min(now + REMOTE_SYNC_LOCK_TTL_MS, context.deadlineAt)
        if (expiresAt <= now) {
          throw this.abortSyncRun(context, this.formatSyncDeadlineExceededMessage(context, '续租远端同步锁'))
        }

        const renewedLock: RemoteSyncLock = {
          ...remoteLock,
          updatedAt: now,
          expiresAt,
          leaseMs: REMOTE_SYNC_LOCK_TTL_MS,
          deadlineAt: context.deadlineAt,
          maxRuntimeMs: context.maxRuntimeMs,
          runtimeId: lock.runtimeId ?? this.runtimeId
        }
        await runWebDavOperation(
          `renewing remote data sync lock ${lock.path}`,
          () => client.putFileContents(lock.path, JSON.stringify(renewedLock, null, 2), { overwrite: true }),
          { logger }
        )
      } catch (error) {
        renewalError = error
        logger.warn('Failed to renew remote data sync lock', error as Error)
        if (context.aborted || Date.now() >= context.deadlineAt) {
          stopped = true
          if (interval) {
            clearInterval(interval)
            interval = null
          }
        }
      }
    }

    interval = setInterval(() => {
      if (!stopped) {
        void renew()
      }
    }, REMOTE_SYNC_LOCK_RENEW_INTERVAL_MS)
    if (typeof interval === 'object' && interval && 'unref' in interval && typeof interval.unref === 'function') {
      interval.unref()
    }

    return {
      stop: () => {
        stopped = true
        if (interval) {
          clearInterval(interval)
          interval = null
        }
      },
      getError: () => renewalError
    }
  }

  private async assertRemoteLockStillOwned(client: WebDAVClient, lock: RemoteSyncLockHandle | null) {
    if (!lock || lock.type === 'webdav') return

    const remoteLock = await this.readRemoteLock(client, lock.path)
    if (!remoteLock || remoteLock.token !== lock.token || remoteLock.ownerId !== lock.ownerId) {
      throw new Error('远端同步锁在同步过程中已被其他设备修改。为避免覆盖其他设备的数据，本次同步已停止，请重新同步。')
    }

    if (this.isRemoteLockExpired(remoteLock)) {
      throw new Error('远端同步锁已过期。为避免长时间同步后覆盖其他设备的数据，本次同步已停止，请重新同步。')
    }

    if (this.isRemoteLockRuntimeExceeded(remoteLock)) {
      throw new Error(
        '远端同步锁已超过最长占用时间。为避免长时间同步后覆盖其他设备的数据，本次同步已停止，请重新同步。'
      )
    }

    const blockingLocks = await this.listBlockingRemoteLocks(
      client,
      path.posix.dirname(path.posix.dirname(lock.path)),
      lock.ownerId,
      {
        currentToken: lock.token
      }
    )
    if (blockingLocks.length > 0) {
      throw new Error(
        '远端同步锁在同步过程中发现其他设备的活动锁。为避免覆盖其他设备的数据，本次同步已停止，请重新同步。'
      )
    }
  }

  async listRemoteDirectories(config: WebDavConfig, remotePath = '/'): Promise<DataSyncRemoteDirectoryList> {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)

    const client = this.createRawWebDavClient(normalizedConfig)
    let currentPath = normalizeWebDavDirectoryPath(remotePath || '/')
    let contents: FileStat[]

    const readDirectory = async (targetPath: string) =>
      normalizeDirectoryContents(
        await runWebDavOperation(
          `listing remote directory ${targetPath}`,
          () => client.getDirectoryContents(targetPath),
          { logger }
        )
      )

    try {
      contents = await readDirectory(currentPath)
    } catch (error) {
      const fallbackPath = parentDirectoryPath(currentPath)
      if (error instanceof WebDavOperationError && error.status === 404 && fallbackPath) {
        logger.warn(`Remote directory ${currentPath} does not exist; falling back to ${fallbackPath}`, error)
        currentPath = fallbackPath
        contents = await readDirectory(currentPath)
      } else {
        throw error
      }
    }

    return {
      path: currentPath,
      parentPath: parentDirectoryPath(currentPath),
      directories: contents
        .filter((entry) => entry.type === 'directory')
        .map((entry) => {
          const entryPath = normalizeWebDavDirectoryPath(entry.filename || path.posix.join(currentPath, entry.basename))
          return {
            name: entry.basename || path.posix.basename(entryPath) || entryPath,
            path: entryPath,
            modifiedAt: entry.lastmod || null
          }
        })
        .filter((entry) => entry.path !== currentPath)
        .sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  async checkWriteAccess(config: WebDavConfig): Promise<DataSyncWriteAccessResult> {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)

    const db = await getAppDataDatabase()
    const { client, basePath } = this.createWebDavClient(normalizedConfig)
    await this.ensureDirectory(client, basePath)
    await this.assertRemoteLockAvailable(client, basePath, db.getDeviceId())
    await this.assertWriteAccess(client, basePath)
    await this.assertStorageV2WriteAccess(client, basePath)

    return { ok: true, basePath }
  }

  private normalizeNotesManifest(manifest?: RemoteNotesManifest | null): RemoteNotesManifest {
    if (manifest != null && !isPlainRecord(manifest)) {
      throw new Error('远端笔记同步 manifest 格式损坏。为避免把损坏状态当作空笔记覆盖，本次同步已停止。')
    }
    if (manifest?.files != null && !isPlainRecord(manifest.files)) {
      throw new Error('远端笔记文件 manifest 格式损坏。为避免把损坏状态当作空笔记覆盖，本次同步已停止。')
    }

    const files: Record<string, RemoteNotesFileMeta> = Object.create(null)

    for (const [id, meta] of Object.entries(manifest?.files ?? {})) {
      if (!meta || typeof meta !== 'object') {
        throw new Error(`远端笔记同步状态损坏：${id}`)
      }

      const relativePath = normalizeNotesRelativePath(meta.relativePath || id, 'Remote notes file path')
      const valueHash = typeof meta.valueHash === 'string' ? meta.valueHash : ''
      if (!/^[a-f0-9]{64}$/i.test(valueHash)) {
        throw new Error(`远端笔记文件校验信息损坏：${relativePath}`)
      }

      const deletedAt = meta.deletedAt == null ? null : Number(meta.deletedAt)
      const pathValue = meta.path == null ? null : normalizeRemoteRelativePath(meta.path, 'Remote notes artifact path')
      if (!deletedAt && !pathValue) {
        throw new Error(`远端笔记文件缺少内容文件：${relativePath}`)
      }
      if (pathValue && !pathValue.startsWith(`${NOTES_REMOTE_ARTIFACT_ROOT}/`)) {
        throw new Error(`远端笔记文件路径越界：${relativePath}`)
      }
      const byteSize = Number(meta.byteSize)
      if (!deletedAt && (!Number.isFinite(byteSize) || byteSize < 0)) {
        throw new Error(`远端笔记文件大小无效：${relativePath}。为避免导入异常笔记，本次同步已停止。`)
      }
      if (!deletedAt && byteSize > NOTES_MAX_FILE_BYTES) {
        throw new Error(
          `远端笔记文件过大：${relativePath}（${byteSize} 字节，限制 ${NOTES_MAX_FILE_BYTES} 字节）。WebDAV 多端同步不适合搬运超大笔记或附件，请清理后重试。`
        )
      }

      files[relativePath] = {
        version: 1,
        relativePath,
        valueHash: valueHash.toLowerCase(),
        byteSize: Math.max(0, byteSize || 0),
        updatedAt: Math.max(0, Number(meta.updatedAt) || deletedAt || 0),
        deletedAt: deletedAt && Number.isFinite(deletedAt) ? deletedAt : null,
        deviceId: typeof meta.deviceId === 'string' && meta.deviceId ? meta.deviceId : 'unknown',
        path: pathValue
      }
    }
    const activeFiles = Object.values(files).filter((meta) => !meta.deletedAt)
    if (activeFiles.length > NOTES_MAX_FILE_COUNT) {
      throw new Error(
        `远端笔记文件数量过多（${activeFiles.length} 个，限制 ${NOTES_MAX_FILE_COUNT} 个）。为避免 WebDAV 频率限制，本次同步已停止。`
      )
    }
    const activeTotalBytes = activeFiles.reduce((sum, meta) => sum + meta.byteSize, 0)
    if (activeTotalBytes > NOTES_MAX_TOTAL_BYTES) {
      throw new Error(
        `远端笔记目录过大（${activeTotalBytes} 字节，限制 ${NOTES_MAX_TOTAL_BYTES} 字节）。WebDAV 多端同步不适合搬运超大目录，请清理后重试。`
      )
    }

    return {
      version: 1,
      updatedAt: Math.max(0, Number(manifest?.updatedAt) || 0),
      files
    }
  }

  private normalizeRuntimeDirectoriesManifest(
    manifest?: RemoteRuntimeDirectoriesManifest | null
  ): RemoteRuntimeDirectoriesManifest {
    if (manifest != null && !isPlainRecord(manifest)) {
      throw new Error('远端运行时目录同步 manifest 格式损坏。为避免把损坏状态当作空目录覆盖，本次同步已停止。')
    }
    if (manifest?.directories != null && !isPlainRecord(manifest.directories)) {
      throw new Error('远端运行时目录列表 manifest 格式损坏。为避免把损坏状态当作空目录覆盖，本次同步已停止。')
    }

    const directories: Record<string, RemoteRuntimeDirectoryMeta> = Object.create(null)

    for (const [id, meta] of Object.entries(manifest?.directories ?? {})) {
      if (!meta || typeof meta !== 'object') {
        throw new Error(`远端运行时目录同步状态损坏：${id}`)
      }

      const name = normalizeRuntimeDirectoryName(meta.name || id)
      const valueHash = typeof meta.valueHash === 'string' ? meta.valueHash : ''
      if (!/^[a-f0-9]{64}$/i.test(valueHash)) {
        throw new Error(`远端运行时目录校验信息损坏：${name}`)
      }
      const normalizedValueHash = valueHash.toLowerCase()
      const byteSize = Math.max(0, Number(meta.byteSize) || 0)
      const fileCount = Math.max(0, Number(meta.fileCount) || 0)
      if (byteSize === 0 && fileCount === 0 && normalizedValueHash !== EMPTY_RUNTIME_DIRECTORY_VALUE_HASH) {
        throw new Error(`远端运行时目录空状态校验信息损坏：${name}`)
      }

      const remotePath = normalizeRemoteRelativePath(meta.path, 'Remote runtime directory bundle path')
      if (!remotePath.startsWith(`${RUNTIME_DIRECTORIES_REMOTE_ROOT}/`)) {
        throw new Error(`远端运行时目录文件路径越界：${name}`)
      }

      directories[name] = {
        version: 1,
        name,
        valueHash: normalizedValueHash,
        byteSize,
        compressedByteSize: Math.max(0, Number(meta.compressedByteSize) || 0),
        fileCount,
        updatedAt: Math.max(0, Number(meta.updatedAt) || 0),
        deviceId: typeof meta.deviceId === 'string' && meta.deviceId ? meta.deviceId : 'unknown',
        path: remotePath
      }
    }

    return {
      version: 1,
      updatedAt: Math.max(0, Number(manifest?.updatedAt) || 0),
      directories
    }
  }

  private normalizeManifest(manifest: RemoteManifest | null): RemoteManifest {
    if (manifest != null && !isPlainRecord(manifest)) {
      throw new Error('远端同步状态 manifest.json 格式损坏。为避免覆盖其他设备的数据，本次同步已停止。')
    }

    const nextManifest = manifest ?? makeManifest()
    nextManifest.generation = Number.isFinite(nextManifest.generation) ? Number(nextManifest.generation) : 0
    nextManifest.records = normalizeAppDataRecordManifest(nextManifest.records)
    nextManifest.syncSpace = normalizeRemoteSyncSpace(nextManifest.syncSpace)
    if (nextManifest.storageV2 != null && !isPlainRecord(nextManifest.storageV2)) {
      throw new Error('远端 Storage v2 manifest 格式损坏。为避免把损坏状态当作空数据覆盖，本次同步已停止。')
    }
    nextManifest.storageV2 = nextManifest.storageV2 ?? null
    nextManifest.notes = this.normalizeNotesManifest(nextManifest.notes)
    nextManifest.runtimeDirectories = this.normalizeRuntimeDirectoriesManifest(nextManifest.runtimeDirectories)
    nextManifest.snapshots = normalizeSnapshotManifest(nextManifest.snapshots)
    nextManifest.latestSnapshot = normalizeLatestSnapshotMeta(nextManifest.latestSnapshot)
    return nextManifest
  }

  private ensureSyncSpace(manifest: RemoteManifest, now = Date.now()) {
    if (isUsableSyncSpace(manifest.syncSpace)) return manifest.syncSpace

    manifest.syncSpace = makeSyncSpace(now)
    return manifest.syncSpace
  }

  private captureManifestBaseline(
    rawManifest: RemoteManifest | null,
    manifest: RemoteManifest
  ): RemoteManifestBaseline {
    return {
      existed: Boolean(rawManifest),
      generation: manifest.generation,
      hash: rawManifest ? hashJsonValue(manifest) : null
    }
  }

  private async assertRemoteManifestUnchanged(
    client: WebDAVClient,
    manifestPath: string,
    baseline: RemoteManifestBaseline
  ) {
    const latestRawManifest = await this.readJson<RemoteManifest>(client, manifestPath, {
      throwOnInvalidJson: true,
      maxBytes: REMOTE_MANIFEST_MAX_BYTES,
      label: '远端同步状态 manifest.json'
    })
    if (!baseline.existed && !latestRawManifest) return
    if (!latestRawManifest) {
      throw new Error('远端同步状态在同步过程中被删除。为避免覆盖其他设备的数据，本次同步已停止，请重新同步。')
    }

    const latestManifest = this.normalizeManifest(latestRawManifest)
    const latestHash = hashJsonValue(latestManifest)
    if (latestManifest.generation !== baseline.generation || latestHash !== baseline.hash) {
      throw new Error(
        '远端同步状态在同步过程中已被其他设备修改。为避免覆盖其他设备的数据，本次同步已停止，请重新同步。'
      )
    }
  }

  private updateSummaryRemoteState(summary: DataSyncSummary, manifest: RemoteManifest) {
    summary.remoteGeneration = manifest.generation
    summary.remoteManifestHash = hashJsonValue(manifest)
    summary.syncSpaceId = manifest.syncSpace?.id ?? null
    summary.storageBundleHash = manifest.storageV2?.bundle?.valueHash ?? null
    summary.storageRecordCount =
      manifest.storageV2?.bundle?.recordCount ?? Object.keys(manifest.storageV2?.records ?? {}).length
    summary.storageBlobCount =
      manifest.storageV2?.bundle?.blobCount ?? Object.keys(manifest.storageV2?.blobs ?? {}).length
  }

  private addStorageV2Summary(summary: DataSyncSummary, storageSummary: StorageV2WebDavRecordSyncSummary) {
    summary.storageUploaded += storageSummary.storageUploaded
    summary.storageDownloaded += storageSummary.storageDownloaded
    summary.storageDeleted += storageSummary.storageDeleted
    summary.storageConflicts += storageSummary.storageConflicts
    summary.storageResolvedConflicts += storageSummary.storageResolvedConflicts
    summary.storageSkipped += storageSummary.storageSkipped
    summary.blobUploaded += storageSummary.blobUploaded
    summary.blobDownloaded += storageSummary.blobDownloaded
    summary.secretUploaded += storageSummary.secretUploaded
    summary.secretDownloaded += storageSummary.secretDownloaded
  }

  private async pullRemoteRecord(client: WebDAVClient, basePath: string, meta: RemoteRecordMeta) {
    const remotePath = path.posix.join(basePath, normalizeRemoteRelativePath(meta.path, 'Remote data record path'))
    const record = await this.readJson<AppDataRecord>(client, remotePath, {
      maxBytes: REMOTE_APP_DATA_RECORD_MAX_BYTES,
      label: `远端应用数据记录 ${meta.scope}:${meta.key}`
    })
    if (!record) {
      throw new Error(`远端同步记录缺失：${meta.scope}:${meta.key}。为避免误判同步成功，本次同步已停止。`)
    }
    if (record.scope !== meta.scope || record.key !== meta.key || record.valueHash !== meta.valueHash) {
      throw new Error(`远端同步记录校验失败：${meta.scope}:${meta.key}。为避免导入损坏数据，本次同步已停止。`)
    }

    return record
  }

  private async pushRecord(client: WebDAVClient, basePath: string, record: AppDataRecord, manifest: RemoteManifest) {
    const relativePath = recordPath(record)
    const byteSize = jsonByteLength(record)
    if (byteSize > REMOTE_APP_DATA_RECORD_MAX_BYTES) {
      throw new Error(
        `同步数据失败：应用数据记录 ${record.scope}:${record.key} 过大（${byteSize} 字节，限制 ${REMOTE_APP_DATA_RECORD_MAX_BYTES} 字节）。请清理异常大的设置或缓存后重试。`
      )
    }
    await this.writeJson(client, path.posix.join(basePath, relativePath), record)

    manifest.records[recordId(record.scope, record.key)] = {
      scope: record.scope,
      key: record.key,
      valueHash: record.valueHash,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt ?? null,
      deviceId: record.deviceId,
      version: record.version,
      path: relativePath
    }
  }

  private async applyRemoteRecord(db: AppDataDatabase, record: AppDataRecord) {
    await storageV2AppDataKvMirrorService.upsertRecordSnapshot(record)
    await db.applyRemoteRecord(record, { storageV2Mirrored: true })
  }

  private resolveLocalNotesFilePath(rootDir: string, relativePath: string) {
    const resolvedRoot = path.resolve(rootDir)
    const resolvedPath = path.resolve(resolvedRoot, ...normalizeNotesRelativePath(relativePath).split('/'))
    const relativeToRoot = path.relative(resolvedRoot, resolvedPath)
    if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`笔记文件路径越界：${relativePath}`)
    }

    return resolvedPath
  }

  private async listLocalNotesFiles(rootDir: string, context: SyncRunContext): Promise<LocalNotesFile[]> {
    const files: LocalNotesFile[] = []
    let totalBytes = 0

    const walk = async (currentDir: string) => {
      this.assertSyncRunActive(context, '扫描本地笔记文件')
      const entries = await fsp.readdir(currentDir, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })

      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        this.assertSyncRunActive(context, '扫描本地笔记文件')
        if (isIgnoredNotesEntry(entry.name) || entry.isSymbolicLink()) continue

        const localPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await walk(localPath)
          continue
        }
        if (!entry.isFile()) continue

        const stat = await fsp.stat(localPath)
        if (!stat.isFile()) continue
        const relativePath = normalizeNotesRelativePath(path.relative(rootDir, localPath).split(path.sep).join('/'))
        if (stat.size > NOTES_MAX_FILE_BYTES) {
          throw new Error(
            `本地笔记文件过大：${relativePath}（${stat.size} 字节，限制 ${NOTES_MAX_FILE_BYTES} 字节）。WebDAV 多端同步不适合搬运超大笔记或附件，请清理后重试。`
          )
        }
        totalBytes += stat.size
        if (totalBytes > NOTES_MAX_TOTAL_BYTES) {
          throw new Error(
            `本地笔记目录过大（超过 ${NOTES_MAX_TOTAL_BYTES} 字节）。WebDAV 多端同步不适合搬运超大目录，请清理后重试。`
          )
        }
        if (files.length + 1 > NOTES_MAX_FILE_COUNT) {
          throw new Error(
            `本地笔记文件数量过多（超过 ${NOTES_MAX_FILE_COUNT} 个）。为避免 WebDAV 频率限制，本次同步已停止；请清理后重试。`
          )
        }

        files.push({
          relativePath,
          localPath,
          valueHash: await sha256File(localPath),
          byteSize: stat.size,
          updatedAt: Math.max(0, Math.floor(stat.mtimeMs))
        })
      }
    }

    await fsp.mkdir(rootDir, { recursive: true })
    await walk(rootDir)
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }

  private assertNotesFileBufferIntegrity(
    buffer: Buffer,
    meta: Pick<RemoteNotesFileMeta, 'relativePath' | 'valueHash' | 'byteSize'>
  ) {
    if (buffer.byteLength !== meta.byteSize) {
      throw new Error(`远端笔记文件大小不匹配：${meta.relativePath}。为避免导入损坏笔记，本次同步已停止。`)
    }

    if (sha256Buffer(buffer) !== meta.valueHash) {
      throw new Error(`远端笔记文件校验失败：${meta.relativePath}。为避免导入损坏笔记，本次同步已停止。`)
    }
  }

  private async assertRemoteNotesFileIntegrity(
    client: WebDAVClient,
    remotePath: string,
    meta: Pick<RemoteNotesFileMeta, 'relativePath' | 'valueHash' | 'byteSize'>
  ) {
    const contents = await runWebDavOperation(
      `verifying uploaded notes file ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    this.assertNotesFileBufferIntegrity(bufferFromRemote(contents), meta)
  }

  private async pushNotesFile(
    client: WebDAVClient,
    basePath: string,
    manifest: RemoteNotesManifest,
    localFile: LocalNotesFile,
    deviceId: string
  ) {
    const relativePath = notesFileRemotePath(localFile.relativePath, localFile.valueHash)
    const remotePath = path.posix.join(basePath, relativePath)

    await this.ensureDirectory(client, path.posix.dirname(remotePath))
    await runWebDavOperation(
      `uploading notes file ${remotePath}`,
      () =>
        client.putFileContents(remotePath, fs.createReadStream(localFile.localPath), {
          overwrite: true,
          contentLength: localFile.byteSize
        }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    await this.assertRemoteNotesFileIntegrity(client, remotePath, {
      relativePath: localFile.relativePath,
      valueHash: localFile.valueHash,
      byteSize: localFile.byteSize
    })

    manifest.files[localFile.relativePath] = {
      version: 1,
      relativePath: localFile.relativePath,
      valueHash: localFile.valueHash,
      byteSize: localFile.byteSize,
      updatedAt: localFile.updatedAt,
      deletedAt: null,
      deviceId,
      path: relativePath
    }
  }

  private async pullNotesFile(client: WebDAVClient, basePath: string, rootDir: string, meta: RemoteNotesFileMeta) {
    if (meta.deletedAt || !meta.path) return

    const relativePath = normalizeNotesRelativePath(meta.relativePath)
    if (!Number.isFinite(meta.byteSize) || meta.byteSize < 0) {
      throw new Error(`远端笔记文件大小无效：${relativePath}。为避免导入异常笔记，本次同步已停止。`)
    }
    if (meta.byteSize > NOTES_MAX_FILE_BYTES) {
      throw new Error(
        `远端笔记文件过大：${relativePath}（${meta.byteSize} 字节，限制 ${NOTES_MAX_FILE_BYTES} 字节）。WebDAV 多端同步不适合搬运超大笔记或附件，请清理后重试。`
      )
    }
    const remotePath = path.posix.join(basePath, normalizeRemoteRelativePath(meta.path, 'Remote notes artifact path'))
    await this.assertRemoteFileWithinByteLimit(client, remotePath, `远端笔记文件 ${relativePath}`, NOTES_MAX_FILE_BYTES)
    const contents = await runWebDavOperation(
      `downloading notes file ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    const buffer = bufferFromRemote(contents)
    this.assertNotesFileBufferIntegrity(buffer, meta)

    const localPath = this.resolveLocalNotesFilePath(rootDir, relativePath)
    await fsp.mkdir(path.dirname(localPath), { recursive: true })
    const tempPath = `${localPath}.cherry-studio-pi-sync-download-${process.pid}-${Date.now()}-${randomBytes(
      4
    ).toString('hex')}.tmp`

    try {
      await fsp.writeFile(tempPath, buffer)
      await fsp.rename(tempPath, localPath)
      const mtime = new Date(Math.max(0, meta.updatedAt))
      await fsp.utimes(localPath, mtime, mtime).catch(() => undefined)
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  private async removeLocalNotesFile(rootDir: string, relativePath: string) {
    await fsp.rm(this.resolveLocalNotesFilePath(rootDir, relativePath), { force: true })
  }

  private markNotesFileDeleted(
    manifest: RemoteNotesManifest,
    relativePath: string,
    previous: Pick<RemoteNotesFileMeta, 'valueHash' | 'updatedAt' | 'deviceId'>,
    deviceId: string,
    deletedAt: number
  ) {
    manifest.files[relativePath] = {
      version: 1,
      relativePath,
      valueHash: previous.valueHash,
      byteSize: 0,
      updatedAt: deletedAt,
      deletedAt,
      deviceId: deviceId || previous.deviceId,
      path: null
    }
  }

  private async syncDefaultNotesDirectory(
    client: WebDAVClient,
    basePath: string,
    inputManifest: RemoteNotesManifest | null | undefined,
    db: AppDataDatabase,
    summary: DataSyncSummary,
    context: SyncRunContext,
    stageSyncState: (id: string, value: unknown) => void,
    options: { preferRemoteOnFirstJoin?: boolean } = {}
  ) {
    const notesManifest = this.normalizeNotesManifest(inputManifest)
    const deviceId = db.getDeviceId()
    const rootDir = getNotesDir()
    const localFiles = await this.listLocalNotesFiles(rootDir, context)
    const localByPath = new Map(localFiles.map((file) => [file.relativePath, file]))
    const remoteActiveCount = Object.values(notesManifest.files).filter((meta) => !meta.deletedAt).length
    const protectEmptyLocalDirectory = localFiles.length === 0 && remoteActiveCount > 0
    const allPaths = Array.from(new Set([...localByPath.keys(), ...Object.keys(notesManifest.files)])).sort(
      (left, right) => left.localeCompare(right)
    )
    let manifestChanged = false

    const uploadLocal = async (localFile: LocalNotesFile) => {
      this.assertSyncRunActive(context, '上传本地笔记文件')
      await this.pushNotesFile(client, basePath, notesManifest, localFile, deviceId)
      stageSyncState(notesSyncStateKey(deviceId, localFile.relativePath), localNotesCursor(localFile))
      summary.uploaded += 1
      manifestChanged = true
    }

    const downloadRemote = async (remoteMeta: RemoteNotesFileMeta, localFile?: LocalNotesFile) => {
      this.assertSyncRunActive(context, '下载远端笔记文件')
      if (localFile && localFile.valueHash !== remoteMeta.valueHash) {
        await this.createJoinSafetySnapshotOnce(db, summary)
      }
      await this.pullNotesFile(client, basePath, rootDir, remoteMeta)
      stageSyncState(notesSyncStateKey(deviceId, remoteMeta.relativePath), notesRemoteCursor(remoteMeta))
      summary.downloaded += 1
    }

    const deleteRemote = (relativePath: string, remoteMeta: RemoteNotesFileMeta) => {
      this.markNotesFileDeleted(notesManifest, relativePath, remoteMeta, deviceId, summary.lastSyncAt)
      stageSyncState(notesSyncStateKey(deviceId, relativePath), notesRemoteCursor(notesManifest.files[relativePath]))
      summary.deleted += 1
      manifestChanged = true
    }

    const deleteLocal = async (relativePath: string, remoteMeta: RemoteNotesFileMeta) => {
      this.assertSyncRunActive(context, '删除本地笔记文件')
      await this.removeLocalNotesFile(rootDir, relativePath)
      stageSyncState(notesSyncStateKey(deviceId, relativePath), notesRemoteCursor(remoteMeta))
      summary.deleted += 1
    }

    for (const relativePath of allPaths) {
      this.assertSyncRunActive(context, '同步默认笔记目录')
      const localFile = localByPath.get(relativePath)
      const remoteMeta = notesManifest.files[relativePath]
      const syncKey = notesSyncStateKey(deviceId, relativePath)
      const lastCursorValue = await this.getSyncState<unknown>(db, syncKey)
      const lastCursor = typeof lastCursorValue === 'string' ? lastCursorValue : null
      const localCursor = localFile ? localNotesCursor(localFile) : null

      if (localFile && !remoteMeta) {
        if (options.preferRemoteOnFirstJoin && !lastCursor) {
          stageSyncState(syncKey, deferredLocalSyncCursor(localCursor!))
          summary.skipped += 1
          continue
        }
        if (lastCursor === deferredLocalSyncCursor(localCursor!)) {
          summary.skipped += 1
          continue
        }

        await uploadLocal(localFile)
        continue
      }

      if (!localFile && remoteMeta) {
        if (remoteMeta.deletedAt) {
          stageSyncState(syncKey, notesRemoteCursor(remoteMeta))
          summary.skipped += 1
          continue
        }

        if (!protectEmptyLocalDirectory && lastCursor === notesRemoteCursor(remoteMeta)) {
          deleteRemote(relativePath, remoteMeta)
          continue
        }

        await downloadRemote(remoteMeta)
        continue
      }

      if (!localFile || !remoteMeta) {
        summary.skipped += 1
        continue
      }

      if (remoteMeta.deletedAt) {
        const localChanged = hasLocalCursorChangedSinceSync(lastCursor, localCursor)
        const remoteDeletedAt = remoteMeta.deletedAt || remoteMeta.updatedAt
        if (localChanged && localFile.updatedAt > remoteDeletedAt) {
          summary.resolvedConflicts += 1
          await uploadLocal(localFile)
        } else {
          await deleteLocal(relativePath, remoteMeta)
        }
        continue
      }

      const remoteCursor = notesRemoteCursor(remoteMeta)
      if (localFile.valueHash === remoteMeta.valueHash) {
        stageSyncState(syncKey, localCursor)
        summary.skipped += 1
        continue
      }

      const localChanged = hasLocalCursorChangedSinceSync(lastCursor, localCursor)
      const remoteChanged = remoteCursor !== lastCursor

      if (!lastCursor) {
        if (options.preferRemoteOnFirstJoin) {
          await downloadRemote(remoteMeta, localFile)
          continue
        }

        summary.resolvedConflicts += 1
        if (shouldLocalNotesFileWin(localFile, remoteMeta)) {
          await uploadLocal(localFile)
        } else {
          await downloadRemote(remoteMeta, localFile)
        }
        continue
      }

      if (localChanged && !remoteChanged) {
        await uploadLocal(localFile)
        continue
      }

      if (!localChanged && remoteChanged) {
        await downloadRemote(remoteMeta)
        continue
      }

      summary.resolvedConflicts += 1
      if (shouldLocalNotesFileWin(localFile, remoteMeta)) {
        await uploadLocal(localFile)
      } else {
        await downloadRemote(remoteMeta, localFile)
      }
    }

    if (manifestChanged) {
      notesManifest.updatedAt = summary.lastSyncAt
    }

    return notesManifest
  }

  private getRuntimeDirectoryRoot(name: RuntimeDirectoryName) {
    return getDataPath(name)
  }

  private async createRuntimeDirectorySource(policy: RuntimeDirectoryPolicy, context: SyncRunContext) {
    const sourceRoot = this.getRuntimeDirectoryRoot(policy.name)
    if (policy.snapshot !== 'memory') {
      return { sourceRoot, cleanup: async () => undefined }
    }

    this.assertSyncRunActive(context, '创建记忆目录同步快照')
    const stagingRoot = path.join(
      storageV2DataRootService.ensureDataRoot().dataRoot,
      'temp',
      `data-sync-runtime-directory-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`,
      policy.name
    )
    await this.snapshotMemoryDirectory(sourceRoot, stagingRoot)
    return {
      sourceRoot: stagingRoot,
      cleanup: async () => {
        await fsp.rm(path.dirname(stagingRoot), { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  private async snapshotMemoryDirectory(sourceRoot: string, targetRoot: string) {
    await fsp.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined)
    await fsp.mkdir(targetRoot, { recursive: true })

    const entries = await fsp.readdir(sourceRoot, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })

    for (const entry of entries) {
      if (entry.name === 'memories.db' || entry.name === 'memories.db-wal' || entry.name === 'memories.db-shm') {
        continue
      }

      const sourcePath = path.join(sourceRoot, entry.name)
      const targetPath = path.join(targetRoot, entry.name)
      if (entry.isDirectory()) {
        await fsp.cp(sourcePath, targetPath, { recursive: true, force: true })
      } else if (entry.isFile()) {
        await fsp.copyFile(sourcePath, targetPath)
      }
    }

    const memoryDbPath = path.join(sourceRoot, 'memories.db')
    if (!fs.existsSync(memoryDbPath)) return

    const client = createLibsqlClient({
      url: `file:${memoryDbPath}`,
      intMode: 'number'
    })

    try {
      await client.execute(`VACUUM INTO ${quoteSqlString(path.join(targetRoot, 'memories.db'))}`)
    } finally {
      client.close()
    }
  }

  private async collectRuntimeDirectoryFiles(
    rootDir: string,
    policy: RuntimeDirectoryPolicy,
    context: SyncRunContext
  ): Promise<RuntimeDirectoryFileEntry[]> {
    const files: RuntimeDirectoryFileEntry[] = []
    let totalBytes = 0

    const walk = async (currentDir: string) => {
      this.assertSyncRunActive(context, `扫描${policy.name}目录`)
      const entries = await fsp.readdir(currentDir, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })

      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        this.assertSyncRunActive(context, `扫描${policy.name}目录`)
        if (isIgnoredRuntimeDirectoryEntry(entry.name) || entry.isSymbolicLink()) continue

        const localPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await walk(localPath)
          continue
        }
        if (!entry.isFile()) continue

        const stat = await fsp.stat(localPath)
        if (!stat.isFile()) continue
        if (stat.size > policy.maxFileBytes) {
          throw new Error(
            `${policy.name} 目录中的文件过大（${path.relative(rootDir, localPath)}，${stat.size} 字节）。为避免 WebDAV 流量或单文件限制，本次同步已停止；请清理该目录或改用完整备份。`
          )
        }

        totalBytes += stat.size
        if (totalBytes > policy.maxTotalBytes) {
          throw new Error(
            `${policy.name} 目录过大（超过 ${policy.maxTotalBytes} 字节）。为避免 WebDAV 流量或频率限制，本次同步已停止；请清理该目录或改用完整备份。`
          )
        }

        const relativePath = normalizeNotesRelativePath(path.relative(rootDir, localPath).split(path.sep).join('/'))
        const contents = await fsp.readFile(localPath)
        files.push({
          relativePath,
          valueHash: sha256Buffer(contents),
          byteSize: stat.size,
          updatedAt: Math.max(0, Math.floor(stat.mtimeMs)),
          mode: stat.mode & 0o777,
          contentBase64: contents.toString('base64')
        })
        if (files.length > policy.maxFileCount) {
          throw new Error(
            `${policy.name} 目录文件数量过多（超过 ${policy.maxFileCount} 个）。为避免 WebDAV 流量或频率限制，本次同步已停止；请清理该目录或改用完整备份。`
          )
        }
      }
    }

    await walk(rootDir)
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }

  private async createRuntimeDirectorySnapshot(
    policy: RuntimeDirectoryPolicy,
    context: SyncRunContext
  ): Promise<LocalRuntimeDirectorySnapshot | null> {
    const source = await this.createRuntimeDirectorySource(policy, context)

    try {
      const files = await this.collectRuntimeDirectoryFiles(source.sourceRoot, policy, context)
      if (files.length === 0) return null

      const updatedAt = Math.max(0, ...files.map((file) => file.updatedAt))
      const byteSize = files.reduce((sum, file) => sum + file.byteSize, 0)
      const valueHash = hashJsonValue(
        files.map((file) => [file.relativePath, file.valueHash, file.byteSize, file.mode])
      )
      const bundle: RuntimeDirectoryBundle = {
        version: 1,
        name: policy.name,
        updatedAt,
        files: Object.fromEntries(files.map((file) => [file.relativePath, file]))
      }
      const bundleBuffer = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'), { level: 9 })

      return {
        name: policy.name,
        rootDir: this.getRuntimeDirectoryRoot(policy.name),
        fileCount: files.length,
        byteSize,
        compressedByteSize: bundleBuffer.byteLength,
        updatedAt,
        valueHash,
        bundle: bundleBuffer
      }
    } finally {
      await source.cleanup()
    }
  }

  private createEmptyRuntimeDirectorySnapshot(
    policy: RuntimeDirectoryPolicy,
    updatedAt: number
  ): LocalRuntimeDirectorySnapshot {
    const bundle: RuntimeDirectoryBundle = {
      version: 1,
      name: policy.name,
      updatedAt,
      files: {}
    }
    const bundleBuffer = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'), { level: 9 })
    return {
      name: policy.name,
      rootDir: this.getRuntimeDirectoryRoot(policy.name),
      fileCount: 0,
      byteSize: 0,
      compressedByteSize: bundleBuffer.byteLength,
      updatedAt,
      valueHash: EMPTY_RUNTIME_DIRECTORY_VALUE_HASH,
      bundle: bundleBuffer
    }
  }

  private async runtimeDirectoryExists(name: RuntimeDirectoryName) {
    const stat = await fsp.stat(this.getRuntimeDirectoryRoot(name)).catch(() => null)
    return Boolean(stat?.isDirectory())
  }

  private isEmptyRuntimeDirectoryMeta(meta: RemoteRuntimeDirectoryMeta) {
    return meta.fileCount === 0 && meta.byteSize === 0 && meta.valueHash === EMPTY_RUNTIME_DIRECTORY_VALUE_HASH
  }

  private async pushRuntimeDirectoryBundle(
    client: WebDAVClient,
    basePath: string,
    manifest: RemoteRuntimeDirectoriesManifest,
    snapshot: LocalRuntimeDirectorySnapshot,
    deviceId: string
  ) {
    const relativePath = runtimeDirectoryBundlePath(snapshot.name, snapshot.valueHash)
    const remotePath = path.posix.join(basePath, relativePath)
    const meta: RemoteRuntimeDirectoryMeta = {
      version: 1,
      name: snapshot.name,
      valueHash: snapshot.valueHash,
      byteSize: snapshot.byteSize,
      compressedByteSize: snapshot.compressedByteSize,
      fileCount: snapshot.fileCount,
      updatedAt: snapshot.updatedAt,
      deviceId,
      path: relativePath
    }

    await this.ensureDirectory(client, path.posix.dirname(remotePath))
    const exists = await runWebDavOperation(
      `checking runtime directory bundle ${remotePath}`,
      () => client.exists(remotePath),
      {
        logger
      }
    ).catch(() => false)
    if (!exists) {
      await runWebDavOperation(
        `uploading runtime directory bundle ${remotePath}`,
        () =>
          client.putFileContents(remotePath, snapshot.bundle, {
            overwrite: false,
            contentLength: snapshot.bundle.byteLength
          }),
        { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
      )
    }
    await this.assertRemoteRuntimeDirectoryBundleIntegrity(client, remotePath, meta)

    manifest.directories[snapshot.name] = meta
  }

  private parseRuntimeDirectoryBundle(buffer: Buffer, meta: RemoteRuntimeDirectoryMeta): RuntimeDirectoryBundle {
    const policy = getRuntimeDirectoryPolicy(meta.name)
    let bundle: RuntimeDirectoryBundle
    try {
      bundle = JSON.parse(
        gunzipSync(buffer, { maxOutputLength: runtimeDirectoryBundleJsonByteLimit(policy, meta) }).toString('utf8')
      ) as RuntimeDirectoryBundle
    } catch (error) {
      throw new Error(
        `远端 ${meta.name} 目录数据包无法解压或解析。为避免写入损坏数据，本次同步已停止：${errorMessage(error)}`
      )
    }

    if (bundle.version !== 1 || bundle.name !== meta.name || !bundle.files || typeof bundle.files !== 'object') {
      throw new Error(`远端 ${meta.name} 目录数据包格式不正确。为避免写入损坏数据，本次同步已停止。`)
    }

    const files = Object.values(bundle.files).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    if (files.length > policy.maxFileCount) {
      throw new Error(
        `远端 ${meta.name} 目录文件数量过多（${files.length} 个，限制 ${policy.maxFileCount} 个）。为避免 WebDAV 流量或频率限制，本次同步已停止。`
      )
    }
    let totalBytes = 0
    for (const file of files) {
      normalizeNotesRelativePath(file.relativePath, `Remote ${meta.name} directory file path`)
      const byteSize = Number(file.byteSize)
      if (!Number.isFinite(byteSize) || byteSize < 0) {
        throw new Error(`远端 ${meta.name} 目录数据包包含无效文件大小。为避免写入损坏数据，本次同步已停止。`)
      }
      if (byteSize > policy.maxFileBytes) {
        throw new Error(
          `远端 ${meta.name} 目录中的文件过大（${file.relativePath}，${byteSize} 字节）。为避免 WebDAV 流量或单文件限制，本次同步已停止。`
        )
      }
      totalBytes += byteSize
      if (totalBytes > policy.maxTotalBytes) {
        throw new Error(
          `远端 ${meta.name} 目录过大（超过 ${policy.maxTotalBytes} 字节）。为避免 WebDAV 流量或频率限制，本次同步已停止。`
        )
      }
      if (typeof file.contentBase64 !== 'string') {
        throw new Error(`远端 ${meta.name} 目录数据包包含无效文件内容。为避免写入损坏数据，本次同步已停止。`)
      }
    }
    if (meta.fileCount > 0 && files.length !== meta.fileCount) {
      throw new Error(`远端 ${meta.name} 目录数据包文件数量不匹配。为避免写入损坏数据，本次同步已停止。`)
    }
    if (meta.byteSize > 0 && totalBytes !== meta.byteSize) {
      throw new Error(`远端 ${meta.name} 目录数据包总大小不匹配。为避免写入损坏数据，本次同步已停止。`)
    }
    const valueHash = hashJsonValue(files.map((file) => [file.relativePath, file.valueHash, file.byteSize, file.mode]))
    if (valueHash !== meta.valueHash) {
      throw new Error(`远端 ${meta.name} 目录数据包校验失败。为避免写入损坏数据，本次同步已停止。`)
    }

    return bundle
  }

  private async pullRuntimeDirectoryBundle(client: WebDAVClient, basePath: string, meta: RemoteRuntimeDirectoryMeta) {
    const policy = getRuntimeDirectoryPolicy(meta.name)
    if (meta.fileCount > policy.maxFileCount) {
      throw new Error(
        `远端 ${meta.name} 目录文件数量过多（${meta.fileCount} 个，限制 ${policy.maxFileCount} 个）。为避免 WebDAV 流量或频率限制，本次同步已停止。`
      )
    }
    if (meta.byteSize > policy.maxTotalBytes) {
      throw new Error(
        `远端 ${meta.name} 目录过大（${meta.byteSize} 字节，限制 ${policy.maxTotalBytes} 字节）。为避免 WebDAV 流量或频率限制，本次同步已停止。`
      )
    }
    const maxCompressedBytes = runtimeDirectoryCompressedByteLimit(policy)
    if (meta.compressedByteSize > maxCompressedBytes) {
      throw new Error(
        `远端 ${meta.name} 目录数据包过大（${meta.compressedByteSize} 字节，限制 ${maxCompressedBytes} 字节）。为避免 WebDAV 流量或频率限制，本次同步已停止。`
      )
    }
    const remotePath = path.posix.join(basePath, normalizeRemoteRelativePath(meta.path, 'Remote runtime bundle path'))
    const contents = await runWebDavOperation(
      `downloading runtime directory bundle ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    const buffer = bufferFromRemote(contents)
    if (meta.compressedByteSize > 0 && buffer.byteLength !== meta.compressedByteSize) {
      throw new Error(`远端 ${meta.name} 目录数据包大小不匹配。为避免写入损坏数据，本次同步已停止。`)
    }

    return this.parseRuntimeDirectoryBundle(buffer, meta)
  }

  private assertRuntimeDirectoryBundleBufferIntegrity(buffer: Buffer, meta: RemoteRuntimeDirectoryMeta) {
    if (meta.compressedByteSize > 0 && buffer.byteLength !== meta.compressedByteSize) {
      throw new Error(`远端 ${meta.name} 目录数据包大小不匹配。为避免发布损坏数据，本次同步已停止。`)
    }

    this.parseRuntimeDirectoryBundle(buffer, meta)
  }

  private async assertRemoteRuntimeDirectoryBundleIntegrity(
    client: WebDAVClient,
    remotePath: string,
    meta: RemoteRuntimeDirectoryMeta
  ) {
    await this.assertRemoteFileWithinByteLimit(
      client,
      remotePath,
      `远端 ${meta.name} 目录数据包`,
      runtimeDirectoryCompressedByteLimit(getRuntimeDirectoryPolicy(meta.name))
    )
    const contents = await runWebDavOperation(
      `verifying runtime directory bundle ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    this.assertRuntimeDirectoryBundleBufferIntegrity(bufferFromRemote(contents), meta)
  }

  private async applyRuntimeDirectoryBundle(meta: RemoteRuntimeDirectoryMeta, bundle: RuntimeDirectoryBundle) {
    const rootDir = this.getRuntimeDirectoryRoot(meta.name)
    const tempDir = `${rootDir}.cherry-studio-pi-sync-download-${process.pid}-${Date.now()}-${randomBytes(4).toString(
      'hex'
    )}`

    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    await fsp.mkdir(tempDir, { recursive: true })

    try {
      for (const file of Object.values(bundle.files)) {
        const relativePath = normalizeNotesRelativePath(file.relativePath)
        const buffer = Buffer.from(file.contentBase64, 'base64')
        if (buffer.byteLength !== file.byteSize || sha256Buffer(buffer) !== file.valueHash) {
          throw new Error(`远端 ${meta.name} 目录中的文件校验失败：${relativePath}`)
        }

        const target = this.resolveLocalNotesFilePath(tempDir, relativePath)
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, buffer, { mode: file.mode || 0o644 })
        const mtime = new Date(Math.max(0, file.updatedAt))
        await fsp.utimes(target, mtime, mtime).catch(() => undefined)
        await fsp.chmod(target, file.mode || 0o644).catch(() => undefined)
      }

      if (meta.name === 'Memory') {
        await MemoryService.getInstance()
          .close()
          .catch((error) => {
            logger.warn('Failed to close MemoryService before applying synced memory directory', error as Error)
          })
      }

      await fsp.rm(rootDir, { recursive: true, force: true }).catch(() => undefined)
      await fsp.mkdir(path.dirname(rootDir), { recursive: true })
      await fsp.rename(tempDir, rootDir)
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async syncRuntimeDirectories(
    client: WebDAVClient,
    basePath: string,
    inputManifest: RemoteRuntimeDirectoriesManifest | null | undefined,
    db: AppDataDatabase,
    summary: DataSyncSummary,
    context: SyncRunContext,
    stageSyncState: (id: string, value: unknown) => void,
    options: { preferRemoteOnFirstJoin?: boolean } = {}
  ) {
    const directoriesManifest = this.normalizeRuntimeDirectoriesManifest(inputManifest)
    const deviceId = db.getDeviceId()
    let manifestChanged = false

    const uploadSnapshot = async (snapshot: LocalRuntimeDirectorySnapshot) => {
      this.assertSyncRunActive(context, `上传${snapshot.name}目录`)
      await this.pushRuntimeDirectoryBundle(client, basePath, directoriesManifest, snapshot, deviceId)
      stageSyncState(
        runtimeDirectorySyncStateKey(deviceId, snapshot.name),
        runtimeDirectoryContentCursor(snapshot.valueHash)
      )
      summary.uploaded += 1
      manifestChanged = true
    }

    const downloadRemote = async (
      remoteMeta: RemoteRuntimeDirectoryMeta,
      localSnapshot?: LocalRuntimeDirectorySnapshot | null
    ) => {
      this.assertSyncRunActive(context, `下载${remoteMeta.name}目录`)
      if (localSnapshot && localSnapshot.valueHash !== remoteMeta.valueHash) {
        await this.createJoinSafetySnapshotOnce(db, summary)
      }
      const bundle = await this.pullRuntimeDirectoryBundle(client, basePath, remoteMeta)
      await this.applyRuntimeDirectoryBundle(remoteMeta, bundle)
      stageSyncState(
        runtimeDirectorySyncStateKey(deviceId, remoteMeta.name),
        runtimeDirectoryContentCursor(remoteMeta.valueHash)
      )
      summary.downloaded += 1
    }

    for (const policy of RUNTIME_DIRECTORY_POLICIES) {
      this.assertSyncRunActive(context, `同步${policy.name}目录`)
      const localSnapshot = await this.createRuntimeDirectorySnapshot(policy, context)
      const remoteMeta = directoriesManifest.directories[policy.name]
      const syncKey = runtimeDirectorySyncStateKey(deviceId, policy.name)
      const lastCursorValue = await this.getSyncState<unknown>(db, syncKey)
      const lastCursor = typeof lastCursorValue === 'string' ? lastCursorValue : null
      const localCursor = localSnapshot ? runtimeDirectoryContentCursor(localSnapshot.valueHash) : null

      if (localSnapshot && !remoteMeta) {
        if (options.preferRemoteOnFirstJoin && !lastCursor) {
          stageSyncState(syncKey, deferredLocalSyncCursor(localCursor!))
          summary.skipped += 1
          continue
        }
        if (lastCursor === deferredLocalSyncCursor(localCursor!)) {
          summary.skipped += 1
          continue
        }

        await uploadSnapshot(localSnapshot)
        continue
      }

      if (!localSnapshot && remoteMeta) {
        const remoteCursor = runtimeDirectoryContentCursor(remoteMeta.valueHash)
        if (this.isEmptyRuntimeDirectoryMeta(remoteMeta)) {
          stageSyncState(syncKey, remoteCursor)
          summary.skipped += 1
          continue
        }

        if (
          !options.preferRemoteOnFirstJoin &&
          lastCursor === remoteCursor &&
          (await this.runtimeDirectoryExists(policy.name))
        ) {
          await uploadSnapshot(this.createEmptyRuntimeDirectorySnapshot(policy, summary.lastSyncAt))
          continue
        }

        await downloadRemote(remoteMeta, null)
        continue
      }

      if (!localSnapshot || !remoteMeta) {
        summary.skipped += 1
        continue
      }

      const remoteCursor = runtimeDirectoryContentCursor(remoteMeta.valueHash)
      if (localSnapshot.valueHash === remoteMeta.valueHash) {
        stageSyncState(syncKey, localCursor)
        summary.skipped += 1
        continue
      }

      const localChanged = hasLocalCursorChangedSinceSync(lastCursor, localCursor)
      const remoteChanged = remoteCursor !== lastCursor
      if (!lastCursor) {
        if (options.preferRemoteOnFirstJoin) {
          await downloadRemote(remoteMeta, localSnapshot)
          continue
        }

        summary.resolvedConflicts += 1
        if (localSnapshot.updatedAt > remoteMeta.updatedAt) {
          await uploadSnapshot(localSnapshot)
        } else {
          await downloadRemote(remoteMeta, localSnapshot)
        }
        continue
      }

      if (localChanged && !remoteChanged) {
        await uploadSnapshot(localSnapshot)
        continue
      }

      if (!localChanged && remoteChanged) {
        await downloadRemote(remoteMeta, localSnapshot)
        continue
      }

      summary.resolvedConflicts += 1
      if (localSnapshot.updatedAt > remoteMeta.updatedAt) {
        await uploadSnapshot(localSnapshot)
      } else {
        await downloadRemote(remoteMeta, localSnapshot)
      }
    }

    if (manifestChanged) {
      directoriesManifest.updatedAt = summary.lastSyncAt
    }

    return directoriesManifest
  }

  private async setSyncState(db: AppDataDatabase, id: string, value: unknown) {
    await storageV2AppDataKvMirrorService.upsertSyncState(id, value)
    await db.setSyncState(id, value, { storageV2Mirrored: true })
  }

  private async getSyncState<T = unknown>(db: AppDataDatabase, id: string): Promise<T | null> {
    const legacyValue = await db.getSyncState<T>(id)
    return legacyValue ?? storageV2AppDataKvMirrorService.getSyncState<T>(id)
  }

  private async projectStorageV2RuntimeAfterSync(
    db: AppDataDatabase,
    manifest: StorageV2WebDavRecordSyncManifest | null | undefined,
    summary: DataSyncSummary,
    options: {
      remoteHadStorageDataBeforeSync: boolean
    }
  ): Promise<AppDataDatabase> {
    const fingerprint = storageV2ManifestFingerprint(manifest)
    if (!fingerprint) return db

    const shouldProject =
      options.remoteHadStorageDataBeforeSync ||
      summary.storageDownloaded > 0 ||
      summary.storageDeleted > 0 ||
      summary.storageConflicts > 0 ||
      summary.blobDownloaded > 0
    if (!shouldProject) return db

    const lastProjectedFingerprint = await this.getSyncState<string>(db, STORAGE_V2_RUNTIME_PROJECTION_HASH_KEY)
    if (lastProjectedFingerprint === fingerprint) return db

    const entityTypes = getStorageV2ManifestEntityTypes(manifest)
    const storageRecordsChanged =
      summary.storageDownloaded > 0 ||
      summary.storageDeleted > 0 ||
      summary.storageConflicts > 0 ||
      summary.blobDownloaded > 0
    const canProjectAppDataStrongly = storageRecordsChanged && summary.skipped === 0
    const archiveRoot = path.join(
      storageV2DataRootService.ensureDataRoot().dataRoot,
      'legacy',
      `data-sync-runtime-projection-${Date.now()}`
    )
    let projected = false

    if ([...entityTypes].some((entityType) => AGENT_RUNTIME_ENTITY_TYPES.has(entityType))) {
      await storageV2AgentLegacyProjectionService.projectToLegacyRuntime({ archiveRoot })
      projected = true
    }

    if ([...entityTypes].some((entityType) => FILE_RUNTIME_ENTITY_TYPES.has(entityType))) {
      await storageV2FileLegacyProjectionService.projectToLegacyRuntime({ archiveRoot })
      projected = true
    }

    if ([...entityTypes].some((entityType) => APP_DATA_RUNTIME_ENTITY_TYPES.has(entityType))) {
      if (canProjectAppDataStrongly) {
        await storageV2AppDataLegacyProjectionService.projectToLegacyRuntime({ archiveRoot })
        db = await getAppDataDatabase()
        projected = true
      } else if (
        await storageV2AppDataRuntimeRecoveryService.projectIfLegacyAppRecordListEmpty(
          undefined,
          'data-sync-runtime-projection'
        )
      ) {
        db = await getAppDataDatabase()
        projected = true
      }
    }

    if ([...entityTypes].some((entityType) => RENDERER_HYDRATION_ENTITY_TYPES.has(entityType))) {
      projected = true
    }

    if (!projected) return db

    await this.setSyncState(db, STORAGE_V2_RUNTIME_PROJECTION_HASH_KEY, fingerprint)
    logger.info('Projected synced Storage v2 records to runtime caches', {
      entityTypes: [...entityTypes],
      fingerprint,
      remotePath: summary.remotePath
    })
    return db
  }

  private async createConflict(
    db: AppDataDatabase,
    input: {
      scope: string
      key: string
      localRecord?: AppDataRecord
      remoteRecord: AppDataRecord
      baseHash?: string | null
      resolvedAt?: number | null
    }
  ) {
    const id = `${input.scope}:${input.key}:${hashJsonValue({
      baseHash: input.baseHash ?? null,
      localHash: input.localRecord?.valueHash ?? null,
      remoteHash: input.remoteRecord.valueHash
    }).slice(0, 32)}`
    await storageV2AppDataKvMirrorService.upsertSyncConflict(id, input)
    await db.createConflict({ ...input, id }, { storageV2Mirrored: true })
    return id
  }

  private async createJoinSafetySnapshotOnce(db: AppDataDatabase, summary: DataSyncSummary) {
    if (summary.joinSafetySnapshotCreated) return

    if (!shouldCreateLocalJoinSafetySnapshot()) {
      await this.pruneLocalDataSyncTempBackups({ keepLatestJoinSafety: 0 })
      logger.info(
        'Skipped local full data-sync safety snapshot; record-level conflict audits protect synced data by default',
        {
          deviceId: db.getDeviceId(),
          lastSyncAt: summary.lastSyncAt
        }
      )
      return
    }

    const fileName = joinSafetySnapshotFileName(db.getDeviceId(), summary.lastSyncAt)
    try {
      await this.pruneLocalDataSyncTempBackups({ keepLatestJoinSafety: 0 })
      const localBackupPath = await this.backupManager.backup(
        undefined as unknown as Electron.IpcMainInvokeEvent,
        fileName,
        undefined,
        false
      )
      const stat = await fsp.stat(localBackupPath).catch(() => null)
      await this.pruneLocalDataSyncTempBackups({ keepPath: localBackupPath })

      summary.joinSafetySnapshotCreated = true
      summary.joinSafetySnapshotFileName = fileName
      summary.joinSafetySnapshotPath = localBackupPath
      summary.joinSafetySnapshotBytes = stat?.size ?? 0
      this.pendingFailureSafetySnapshot = {
        joinSafetySnapshotCreated: summary.joinSafetySnapshotCreated,
        joinSafetySnapshotFileName: summary.joinSafetySnapshotFileName,
        joinSafetySnapshotPath: summary.joinSafetySnapshotPath,
        joinSafetySnapshotBytes: summary.joinSafetySnapshotBytes,
        lastSyncAt: summary.lastSyncAt
      }

      logger.info('Created local safety snapshot before applying remote conflict data', {
        fileName,
        localBackupPath,
        byteSize: summary.joinSafetySnapshotBytes
      })
    } catch (error) {
      throw new Error(
        `本机已有数据与远端同步空间存在差异，但创建本地保护快照失败。为避免本机数据被覆盖，本次同步已停止：${errorMessage(
          error
        )}`
      )
    }
  }

  private async pruneLocalDataSyncTempBackups(
    options: { keepPath?: string | null; keepLatestJoinSafety?: number } = {}
  ) {
    const keepLatestJoinSafety = options.keepLatestJoinSafety ?? DATA_SYNC_JOIN_SAFETY_LOCAL_RETENTION
    const keepPath = options.keepPath ? path.resolve(options.keepPath) : null
    const directories = new Set<string>([getDataSyncTempBackupDir(), getLegacyDataSyncTempBackupDir()])
    if (keepPath) {
      directories.add(path.dirname(keepPath))
    }

    for (const directory of directories) {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true })
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          logger.warn('Failed to list data sync temp backup directory for cleanup', {
            directory,
            error: errorMessage(error)
          })
        }
        continue
      }

      const candidates = (
        await Promise.all(
          entries
            .filter((entry) => entry.isFile() && isManagedDataSyncTempBackupFile(entry.name))
            .map(async (entry) => {
              const filePath = path.resolve(directory, entry.name)
              const stat = await fsp.stat(filePath).catch(() => null)
              if (!stat?.isFile()) return null
              return {
                filePath,
                fileName: entry.name,
                mtimeMs: stat.mtimeMs,
                size: stat.size
              }
            })
        )
      ).filter((item): item is { filePath: string; fileName: string; mtimeMs: number; size: number } => Boolean(item))

      const keepPaths = new Set<string>()
      if (keepPath) {
        keepPaths.add(keepPath)
      }

      const latestJoinSafety = candidates
        .filter((candidate) => isJoinSafetyTempBackupFile(candidate.fileName))
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, keepLatestJoinSafety)
      for (const candidate of latestJoinSafety) {
        keepPaths.add(candidate.filePath)
      }

      for (const candidate of candidates) {
        if (keepPaths.has(candidate.filePath)) continue

        await fsp
          .rm(candidate.filePath, { force: true })
          .then(() => {
            logger.info('Removed stale data sync temp backup', {
              filePath: candidate.filePath,
              byteSize: candidate.size
            })
          })
          .catch((error) => {
            logger.warn('Failed to remove stale data sync temp backup', {
              filePath: candidate.filePath,
              error: errorMessage(error)
            })
          })
      }
    }
  }

  private async pushFullSnapshot(
    client: WebDAVClient,
    basePath: string,
    db: AppDataDatabase,
    manifest: RemoteManifest,
    summary: DataSyncSummary
  ) {
    const deviceId = db.getDeviceId()
    const fileName = snapshotFileName(deviceId, summary.lastSyncAt)
    const relativePath = `backups/${fileName}`
    const remotePath = path.posix.join(basePath, relativePath)
    const localBackupPath = await this.backupManager.backup(
      undefined as unknown as Electron.IpcMainInvokeEvent,
      fileName,
      undefined,
      false
    )

    try {
      const stat = await fsp.stat(localBackupPath)
      const checksum = await sha256File(localBackupPath)
      await this.ensureDirectory(client, path.posix.dirname(remotePath))
      await runWebDavOperation(
        `uploading data sync snapshot ${remotePath}`,
        () =>
          client.putFileContents(remotePath, fs.createReadStream(localBackupPath), {
            overwrite: true,
            contentLength: stat.size
          }),
        { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
      )
      await this.assertRemoteSnapshotIntegrity(client, remotePath, stat.size, checksum)

      const snapshot: RemoteSnapshotMeta = {
        id: `${safeFileSegment(deviceId)}.${summary.lastSyncAt}`,
        fileName,
        path: relativePath,
        byteSize: stat.size,
        checksum,
        createdAt: new Date(summary.lastSyncAt).toISOString(),
        uploadedAt: summary.lastSyncAt,
        deviceId,
        format: 'cherry-studio-direct-backup-zip'
      }

      manifest.snapshots = {
        ...manifest.snapshots,
        [snapshot.id]: snapshot
      }
      this.pruneSnapshotManifest(manifest)
      manifest.latestSnapshot = snapshot

      summary.snapshotUploaded = true
      summary.snapshotFileName = fileName
      summary.snapshotBytes = stat.size
    } finally {
      await fsp.rm(localBackupPath, { force: true }).catch(() => undefined)
    }
  }

  private shouldUploadFullSnapshot(db: AppDataDatabase, manifest: RemoteManifest, now: number) {
    if (!shouldAttemptRemoteFullSnapshotUpload()) {
      return false
    }

    const deviceId = db.getDeviceId()
    const existingSnapshot = Object.values(manifest.snapshots ?? {})
      .filter((snapshot) => snapshot.deviceId === deviceId)
      .sort((left, right) => right.uploadedAt - left.uploadedAt)[0]
    return !existingSnapshot?.uploadedAt || now - existingSnapshot.uploadedAt >= SNAPSHOT_UPLOAD_INTERVAL_MS
  }

  private pruneSnapshotManifest(manifest: RemoteManifest) {
    const snapshots = Object.values(manifest.snapshots ?? {})
      .filter((snapshot): snapshot is RemoteSnapshotMeta => Boolean(snapshot?.id && snapshot.path && snapshot.fileName))
      .sort((left, right) => right.uploadedAt - left.uploadedAt)
    const keepIds = new Set<string>()
    const perDeviceCount = new Map<string, number>()

    for (const snapshot of snapshots) {
      const count = perDeviceCount.get(snapshot.deviceId) ?? 0
      if (count < SNAPSHOT_RETENTION_PER_DEVICE) {
        keepIds.add(snapshot.id)
        perDeviceCount.set(snapshot.deviceId, count + 1)
      }
    }

    for (const snapshot of snapshots) {
      if (keepIds.size >= SNAPSHOT_RETENTION_TOTAL) break
      keepIds.add(snapshot.id)
    }

    manifest.snapshots = Object.fromEntries(
      snapshots.filter((snapshot) => keepIds.has(snapshot.id)).map((snapshot) => [snapshot.id, snapshot])
    )
    if (manifest.latestSnapshot && !manifest.snapshots[manifest.latestSnapshot.id]) {
      manifest.latestSnapshot = snapshots.find((snapshot) => keepIds.has(snapshot.id)) ?? null
    }
  }

  private async assertRemoteSnapshotIntegrity(
    client: WebDAVClient,
    remotePath: string,
    byteSize: number,
    checksum: string
  ) {
    const contents = await runWebDavOperation(
      `verifying data sync snapshot ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    const buffer = bufferFromRemote(contents)
    if (buffer.byteLength !== byteSize || sha256Buffer(buffer) !== checksum) {
      throw new Error('远端安全快照校验失败。为避免发布无法恢复的数据，本次同步已停止。')
    }
  }

  async restoreLatestSnapshot(config: WebDavConfig) {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)

    const { client, basePath } = this.createWebDavClient(normalizedConfig)
    const manifestPath = path.posix.join(basePath, 'manifest.json')
    const manifest = this.normalizeManifest(
      await this.readJson<RemoteManifest>(client, manifestPath, {
        throwOnInvalidJson: true,
        maxBytes: REMOTE_MANIFEST_MAX_BYTES,
        label: '远端同步状态 manifest.json'
      })
    )
    const snapshots = Object.values(manifest.snapshots ?? {})
      .filter((snapshot): snapshot is RemoteSnapshotMeta => Boolean(snapshot?.path && snapshot.fileName))
      .sort((left, right) => right.uploadedAt - left.uploadedAt)
    const snapshot = snapshots[0] ?? manifest.latestSnapshot ?? null

    if (!snapshot) {
      throw new Error('No remote data snapshot is available')
    }

    const remotePath = path.posix.join(basePath, normalizeRemoteSnapshotPath(snapshot.path))
    const backupContents = await runWebDavOperation(
      `downloading data sync snapshot ${remotePath}`,
      () => client.getFileContents(remotePath, { format: 'binary' }),
      { logger, timeoutMs: LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS }
    )
    const backupBuffer = bufferFromRemote(backupContents)
    if (backupBuffer.byteLength !== snapshot.byteSize) {
      throw new Error('远端安全快照大小不匹配。为避免恢复损坏数据，本次恢复已停止。')
    }
    if (snapshot.checksum && sha256Buffer(backupBuffer) !== snapshot.checksum) {
      throw new Error('远端安全快照校验失败。为避免恢复损坏数据，本次恢复已停止。')
    }
    const localBackupPath = path.join(
      process.env.TMPDIR || '/tmp',
      'cherry-studio-pi-data-sync',
      `${safeFileSegment(snapshot.id)}.${path.basename(snapshot.fileName)}`
    )
    await fsp.mkdir(path.dirname(localBackupPath), { recursive: true })
    await fsp.writeFile(localBackupPath, backupBuffer)

    try {
      return await this.backupManager.restore(undefined as unknown as Electron.IpcMainInvokeEvent, localBackupPath)
    } finally {
      await fsp.rm(localBackupPath, { force: true }).catch(() => undefined)
    }
  }

  async syncNow(config: WebDavConfig): Promise<DataSyncSummary> {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)

    this.clearExpiredInFlightSync()
    if (this.syncInFlight || this.syncBackgroundInFlight) {
      throw new Error(DATA_SYNC_ALREADY_RUNNING_ERROR)
    }

    const context = this.createSyncRunContext()
    this.syncStartedAt = context.startedAt
    this.syncRunContext = context
    this.pendingFailureSafetySnapshot = null
    const backgroundSync = (async () => {
      await this.pruneLocalDataSyncTempBackups({
        keepLatestJoinSafety: shouldCreateLocalJoinSafetySnapshot() ? DATA_SYNC_JOIN_SAFETY_LOCAL_RETENTION : 0
      })
      return this.performSyncNow(normalizedConfig, context)
    })()
    this.syncBackgroundInFlight = backgroundSync
    backgroundSync
      .finally(() => {
        if (this.syncBackgroundInFlight === backgroundSync) {
          this.syncBackgroundInFlight = null
          this.clearSyncStartedAtIfIdle()
        }
      })
      .catch(() => undefined)

    const sync = this.withSyncRunDeadline(backgroundSync, context)
    this.syncInFlight = sync

    try {
      const result = await sync
      this.pendingFailureSafetySnapshot = null
      return result
    } finally {
      if (this.syncInFlight === sync) {
        this.syncInFlight = null
        this.clearSyncStartedAtIfIdle()
      }
      if (context.aborted) {
        this.clearExpiredInFlightSync()
      }
    }
  }

  private async performSyncNow(config: WebDavConfig, context: SyncRunContext): Promise<DataSyncSummary> {
    const normalizedConfig = this.normalizeSyncWebDavConfig(config)

    this.assertSyncRunActive(context, '初始化同步')
    let db = await getAppDataDatabase()
    const { client, basePath } = this.createWebDavClient(normalizedConfig)
    const manifestPath = path.posix.join(basePath, 'manifest.json')
    const summary: DataSyncSummary = { ...EMPTY_SUMMARY, remotePath: basePath, lastSyncAt: Date.now() }
    const pendingSyncStates = new Map<string, unknown>()
    const stageSyncState = (id: string, value: unknown) => {
      pendingSyncStates.set(id, value)
    }
    let storageSyncStates: StorageV2WebDavRecordSyncStateCommit[] = []

    this.assertSyncRunActive(context, '准备远端目录')
    await this.ensureDirectory(client, basePath)
    this.assertSyncRunActive(context, '创建远端同步锁')
    const remoteLock = await this.acquireRemoteLock(client, basePath, db.getDeviceId(), context)
    const lockRenewal = this.startRemoteLockRenewal(client, remoteLock, context)
    try {
      this.assertSyncRunActive(context, '检查远端写入权限')
      await this.assertWriteAccess(client, basePath)

      this.assertSyncRunActive(context, '读取远端同步状态')
      const rawManifest = await this.readJson<RemoteManifest>(client, manifestPath, {
        throwOnInvalidJson: true,
        maxBytes: REMOTE_MANIFEST_MAX_BYTES,
        label: '远端同步状态 manifest.json'
      })
      this.assertSyncRunActive(context, '合并远端同步状态')
      const manifest = this.normalizeManifest(rawManifest)
      const manifestBaseline = this.captureManifestBaseline(rawManifest, manifest)
      const manifestPublishFingerprintBeforeSync = remoteManifestPublishFingerprint(manifest)
      const appDataArtifactFingerprintBeforeSync = appDataArtifactFingerprint(manifest)
      const storageV2ArtifactFingerprintBeforeSync = storageV2ManifestFingerprint(manifest.storageV2)
      if (!shouldAttemptRemoteFullSnapshotUpload()) {
        manifest.snapshots = {}
        manifest.latestSnapshot = null
      }
      const hadUsableSyncSpaceBeforeSync = isUsableSyncSpace(manifest.syncSpace)
      const syncSpace = this.ensureSyncSpace(manifest, summary.lastSyncAt)
      summary.syncSpaceId = syncSpace.id
      const remoteHadAppDataRecordsBeforeSync = Object.keys(manifest.records ?? {}).length > 0
      const remoteHadStorageDataBeforeSync = hasStorageV2RemoteData(manifest.storageV2)
      const remoteHadNotesBeforeSync = hasNotesRemoteData(manifest.notes)
      const remoteHadRuntimeDirectoriesBeforeSync = hasRuntimeDirectoriesRemoteData(manifest.runtimeDirectories)
      const remoteStorageEntityTypes = getStorageV2ManifestEntityTypes(manifest.storageV2)
      const previousSyncSpaceId =
        (await this.getSyncState<string>(db, DATA_SYNC_SYNC_SPACE_ID_STATE_KEY)) ??
        (await this.getSyncState<DataSyncSummary>(db, 'last-sync-summary'))?.syncSpaceId ??
        null
      const lastRemoteArtifactCleanupAt = await this.getSyncState<number>(
        db,
        DATA_SYNC_LAST_REMOTE_ARTIFACT_CLEANUP_AT_STATE_KEY
      )
      const remoteArtifactCleanupDue = isRemoteArtifactCleanupDue(lastRemoteArtifactCleanupAt, summary.lastSyncAt)
      const joiningExistingSyncSpace =
        hadUsableSyncSpaceBeforeSync && (!previousSyncSpaceId || previousSyncSpaceId !== syncSpace.id)
      const preferRemoteAppDataOnFirstJoin = joiningExistingSyncSpace && remoteHadAppDataRecordsBeforeSync
      const preferRemoteStorageOnFirstJoin = joiningExistingSyncSpace && remoteHadStorageDataBeforeSync
      const preferRemoteNotesOnFirstJoin = joiningExistingSyncSpace && remoteHadNotesBeforeSync
      const preferRemoteRuntimeDirectoriesOnFirstJoin =
        joiningExistingSyncSpace && remoteHadRuntimeDirectoriesBeforeSync
      let localStorageAppRecords: AppDataRecord[] | null = null
      try {
        localStorageAppRecords = await storageV2AppDataKvMirrorService.listRecords(undefined, true)
      } catch (error) {
        logger.warn('Failed to inspect Storage v2 app records before legacy app-data sync fallback', error as Error)
      }

      if (remoteStorageEntityTypes.has('kv_record') || (localStorageAppRecords?.length ?? 0) > 0) {
        manifest.records = {}
      } else {
        let localRecords = await db.listRecords(undefined, true)
        this.assertSyncRunActive(context, '读取本地应用数据')
        if (
          localRecords.length === 0 &&
          (await storageV2AppDataRuntimeRecoveryService.projectIfLegacyAppRecordListEmpty(
            undefined,
            'app-data-sync-empty'
          ))
        ) {
          db = await getAppDataDatabase()
          localRecords = await db.listRecords(undefined, true)
          this.assertSyncRunActive(context, '恢复本地应用数据')
        }
        if (localRecords.length === 0) {
          localRecords = localStorageAppRecords ?? (await storageV2AppDataKvMirrorService.listRecords(undefined, true))
        } else {
          try {
            const storageRecords =
              localStorageAppRecords ?? (await storageV2AppDataKvMirrorService.listRecords(undefined, true))
            localRecords = mergeAppDataRecords(localRecords, storageRecords)
          } catch (error) {
            logger.warn('Failed to merge Storage v2 app records into sync source', error as Error)
          }
        }
        const localById = new Map(localRecords.map((record) => [recordId(record.scope, record.key), record]))
        const allIds = new Set([...localById.keys(), ...Object.keys(manifest.records)])

        for (const id of allIds) {
          this.assertSyncRunActive(context, '同步应用数据记录')
          const localRecord = localById.get(id)
          const remoteMeta = manifest.records[id]
          const lastHash = await this.getSyncState<string>(db, `record:${id}:hash`)

          if (localRecord && !remoteMeta) {
            if (preferRemoteAppDataOnFirstJoin && !lastHash) {
              stageSyncState(`record:${id}:hash`, deferredLocalSyncCursor(localRecord.valueHash))
              summary.skipped += 1
              continue
            }
            if (lastHash === deferredLocalSyncCursor(localRecord.valueHash)) {
              summary.skipped += 1
              continue
            }

            this.assertSyncRunActive(context, '上传应用数据记录')
            await this.pushRecord(client, basePath, localRecord, manifest)
            stageSyncState(`record:${id}:hash`, localRecord.valueHash)
            summary.uploaded += localRecord.deletedAt ? 0 : 1
            summary.deleted += localRecord.deletedAt ? 1 : 0
            continue
          }

          if (!localRecord && remoteMeta) {
            this.assertSyncRunActive(context, '下载应用数据记录')
            const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
            if (remoteRecord) {
              this.assertSyncRunActive(context, '写入本地应用数据记录')
              await this.applyRemoteRecord(db, remoteRecord)
              stageSyncState(`record:${id}:hash`, remoteRecord.valueHash)
              summary.downloaded += remoteRecord.deletedAt ? 0 : 1
              summary.deleted += remoteRecord.deletedAt ? 1 : 0
            }
            continue
          }

          if (!localRecord || !remoteMeta) {
            summary.skipped += 1
            continue
          }

          if (localRecord.valueHash === remoteMeta.valueHash) {
            stageSyncState(`record:${id}:hash`, localRecord.valueHash)
            summary.skipped += 1
            continue
          }

          const localChanged = hasLocalCursorChangedSinceSync(lastHash, localRecord.valueHash)
          const remoteChanged = remoteMeta.valueHash !== lastHash

          if (!lastHash) {
            const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
            if (remoteRecord) {
              await this.createJoinSafetySnapshotOnce(db, summary)
              if (!preferRemoteAppDataOnFirstJoin) {
                await this.createConflict(db, {
                  scope: localRecord.scope,
                  key: localRecord.key,
                  localRecord,
                  remoteRecord,
                  baseHash: null,
                  resolvedAt: Date.now()
                })
              }
              await this.applyRemoteRecord(db, remoteRecord)
              stageSyncState(`record:${id}:hash`, remoteRecord.valueHash)
              summary.downloaded += remoteRecord.deletedAt ? 0 : 1
              summary.deleted += remoteRecord.deletedAt ? 1 : 0
              summary.resolvedConflicts += preferRemoteAppDataOnFirstJoin ? 0 : 1
            } else {
              summary.skipped += 1
            }
            continue
          }

          if (localChanged && !remoteChanged) {
            this.assertSyncRunActive(context, '上传应用数据变更')
            await this.pushRecord(client, basePath, localRecord, manifest)
            stageSyncState(`record:${id}:hash`, localRecord.valueHash)
            summary.uploaded += localRecord.deletedAt ? 0 : 1
            summary.deleted += localRecord.deletedAt ? 1 : 0
            continue
          }

          this.assertSyncRunActive(context, '读取远端应用数据变更')
          const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
          if (!remoteRecord) {
            summary.skipped += 1
            continue
          }

          if (!localChanged && remoteChanged) {
            this.assertSyncRunActive(context, '应用远端应用数据变更')
            await this.applyRemoteRecord(db, remoteRecord)
            stageSyncState(`record:${id}:hash`, remoteRecord.valueHash)
            summary.downloaded += remoteRecord.deletedAt ? 0 : 1
            summary.deleted += remoteRecord.deletedAt ? 1 : 0
            continue
          }

          await this.createConflict(db, {
            scope: localRecord.scope,
            key: localRecord.key,
            localRecord,
            remoteRecord,
            baseHash: lastHash,
            resolvedAt: Date.now()
          })
          summary.resolvedConflicts += 1

          const winner = shouldLocalAppRecordWin(localRecord, remoteRecord) ? localRecord : remoteRecord
          if (winner === localRecord) {
            this.assertSyncRunActive(context, '上传冲突解决结果')
            await this.pushRecord(client, basePath, localRecord, manifest)
            summary.uploaded += localRecord.deletedAt ? 0 : 1
          } else {
            this.assertSyncRunActive(context, '应用冲突解决结果')
            await this.createJoinSafetySnapshotOnce(db, summary)
            await this.applyRemoteRecord(db, remoteRecord)
            summary.downloaded += remoteRecord.deletedAt ? 0 : 1
          }
          stageSyncState(`record:${id}:hash`, winner.valueHash)
        }
      }

      this.assertSyncRunActive(context, '同步 Storage v2 数据')
      const storageSync = await storageV2WebDavRecordSyncService.sync(client, basePath, manifest.storageV2, {
        secretKeyMaterial: syncSpace.keyMaterial,
        legacySecretKeyMaterial: hadUsableSyncSpaceBeforeSync
          ? undefined
          : `${normalizeWebDavHost(normalizedConfig.webdavHost)}\n${normalizedConfig.webdavUser}\n${normalizedConfig.webdavPass}`,
        beforeRemoteConflictApply: async () => this.createJoinSafetySnapshotOnce(db, summary),
        preferRemoteOnFirstJoin: preferRemoteStorageOnFirstJoin,
        skipWriteAccessProbe: true,
        assertActive: () => this.assertSyncRunActive(context, '同步 Storage v2 数据')
      })
      this.assertSyncRunActive(context, '合并 Storage v2 同步结果')
      manifest.storageV2 = storageSync.manifest
      storageSyncStates = storageSync.syncStates ?? []
      this.addStorageV2Summary(summary, storageSync.summary)
      this.assertSyncRunActive(context, '投影同步后的运行时数据')
      db = await this.projectStorageV2RuntimeAfterSync(db, manifest.storageV2, summary, {
        remoteHadStorageDataBeforeSync
      })

      this.assertSyncRunActive(context, '同步默认笔记文件')
      manifest.notes = await this.syncDefaultNotesDirectory(
        client,
        basePath,
        manifest.notes,
        db,
        summary,
        context,
        stageSyncState,
        { preferRemoteOnFirstJoin: preferRemoteNotesOnFirstJoin }
      )

      this.assertSyncRunActive(context, '同步运行时目录')
      manifest.runtimeDirectories = await this.syncRuntimeDirectories(
        client,
        basePath,
        manifest.runtimeDirectories,
        db,
        summary,
        context,
        stageSyncState,
        { preferRemoteOnFirstJoin: preferRemoteRuntimeDirectoriesOnFirstJoin }
      )

      if (this.shouldUploadFullSnapshot(db, manifest, summary.lastSyncAt)) {
        try {
          this.assertSyncRunActive(context, '上传远端安全快照')
          await this.pushFullSnapshot(client, basePath, db, manifest, summary)
        } catch (error) {
          logger.warn('Skipping optional remote full data sync snapshot after upload failure', error as Error)
        }
      }

      this.assertSyncRunActive(context, '发布远端同步状态')
      const manifestPublishFingerprintAfterSync = remoteManifestPublishFingerprint(manifest)
      const shouldPublishManifest = manifestPublishFingerprintAfterSync !== manifestPublishFingerprintBeforeSync
      if (shouldPublishManifest) {
        manifest.updatedAt = summary.lastSyncAt
        manifest.generation = manifestBaseline.generation + 1
      }
      this.updateSummaryRemoteState(summary, manifest)
      const renewalError = lockRenewal.getError()
      if (renewalError) {
        throw new Error(
          `远端同步锁续租失败。为避免长时间同步后覆盖其他设备的数据，本次同步已停止：${errorMessage(renewalError)}`
        )
      }
      this.assertSyncRunActive(context, '确认远端同步锁')
      await this.assertRemoteLockStillOwned(client, remoteLock)
      this.assertSyncRunActive(context, '确认远端同步状态未被修改')
      await this.assertRemoteManifestUnchanged(client, manifestPath, manifestBaseline)
      if (shouldPublishManifest) {
        this.assertSyncRunActive(context, '写入远端同步状态')
        const manifestByteSize = jsonByteLength(manifest)
        if (manifestByteSize > REMOTE_MANIFEST_MAX_BYTES) {
          throw new Error(
            `远端同步状态 manifest.json 过大（${manifestByteSize} 字节，限制 ${REMOTE_MANIFEST_MAX_BYTES} 字节）。为避免 WebDAV 同步状态膨胀，本次同步已停止；请减少同步的笔记、运行时目录或旧数据记录后重试。`
          )
        }
        await this.writeJson(client, manifestPath, manifest)
      } else {
        logger.info('Skipped WebDAV manifest publish because remote sync state did not change')
      }
      this.assertSyncRunActive(context, '提交本地同步游标')
      stageSyncState(DATA_SYNC_SYNC_SPACE_ID_STATE_KEY, syncSpace.id)
      await storageV2WebDavRecordSyncService.commitRecordSyncStates(storageSyncStates)
      for (const [id, value] of pendingSyncStates) {
        this.assertSyncRunActive(context, '提交本地应用数据同步游标')
        await this.setSyncState(db, id, value)
      }

      const cleanupErrors: string[] = []
      const appDataArtifactsChanged = appDataArtifactFingerprintBeforeSync !== appDataArtifactFingerprint(manifest)
      const storageV2ArtifactsChanged =
        storageV2ArtifactFingerprintBeforeSync !== storageV2ManifestFingerprint(manifest.storageV2)
      const shouldPruneAppDataArtifacts = remoteArtifactCleanupDue || appDataArtifactsChanged
      const shouldPruneStorageV2Artifacts = remoteArtifactCleanupDue || storageV2ArtifactsChanged
      let ranRemoteArtifactCleanup = false
      this.assertSyncRunActive(context, '清理远端临时文件')
      await this.pruneRemoteRootTempArtifacts(client, basePath, context).catch((error) => {
        logger.warn('Failed to prune stale WebDAV sync root temporary artifacts after sync', error as Error)
        cleanupErrors.push(errorMessage(error))
      })

      if (shouldPruneAppDataArtifacts) {
        ranRemoteArtifactCleanup = true
        this.assertSyncRunActive(context, '清理远端应用数据旧文件')
        await this.pruneRemoteAppDataArtifacts(client, basePath, manifest, context).catch((error) => {
          logger.warn('Failed to prune stale app data WebDAV artifacts after sync', error as Error)
          cleanupErrors.push(errorMessage(error))
        })
      } else {
        logger.info('Skipped deep app data WebDAV artifact cleanup because remote artifact references did not change')
      }

      if (shouldPruneStorageV2Artifacts) {
        ranRemoteArtifactCleanup = true
        this.assertSyncRunActive(context, '清理远端 Storage v2 旧文件')
        await storageV2WebDavRecordSyncService
          .pruneRemoteArtifacts(client, basePath, manifest.storageV2, {
            assertActive: () => this.assertSyncRunActive(context, '清理远端 Storage v2 旧文件')
          })
          .catch((error) => {
            logger.warn('Failed to prune stale Storage v2 WebDAV artifacts after sync', error as Error)
            cleanupErrors.push(errorMessage(error))
          })
      } else {
        logger.info('Skipped deep Storage v2 WebDAV artifact cleanup because remote artifact references did not change')
      }
      if (cleanupErrors.length > 0) {
        throw new Error(
          `远端旧同步文件清理失败。数据已经发布到远端，但为避免 WebDAV 文件数量持续增长，本次同步不会标记为成功。请稍后重试，或检查远端目录删除权限：${cleanupErrors.join('；')}`
        )
      }
      if (ranRemoteArtifactCleanup) {
        this.assertSyncRunActive(context, '记录远端旧文件清理时间')
        await this.setSyncState(db, DATA_SYNC_LAST_REMOTE_ARTIFACT_CLEANUP_AT_STATE_KEY, summary.lastSyncAt)
      }

      summary.status = 'success'
      summary.error = null
      this.assertSyncRunActive(context, '记录同步结果')
      await this.setSyncState(db, 'last-sync-summary', summary)

      return summary
    } finally {
      lockRenewal.stop()
      await this.releaseRemoteLock(client, remoteLock)
    }
  }

  async recordSyncFailure(error: unknown, options: { preserveLastSummary?: boolean } = {}) {
    const db = await getAppDataDatabase()
    const previousSummary = options.preserveLastSummary
      ? ((await db.getSyncState<DataSyncSummary>('last-sync-summary')) ??
        (await storageV2AppDataKvMirrorService.getSyncState<DataSyncSummary>('last-sync-summary')) ??
        null)
      : null
    const pendingSafetySnapshot = this.pendingFailureSafetySnapshot
    const summary: DataSyncSummary = {
      ...EMPTY_SUMMARY,
      ...previousSummary,
      ...pendingSafetySnapshot,
      status: 'failed',
      error: errorMessage(error),
      lastSyncAt: Date.now()
    }
    this.pendingFailureSafetySnapshot = null
    await this.setSyncState(db, 'last-sync-summary', summary)
    return summary
  }

  async getStatus() {
    this.clearExpiredInFlightSync()
    const db = await getAppDataDatabase()
    const storageDeviceId = await storageV2AppDataKvMirrorService.getSyncState<string>('device-id')
    const lastSummary =
      (await db.getSyncState<DataSyncSummary>('last-sync-summary')) ??
      (await storageV2AppDataKvMirrorService.getSyncState<DataSyncSummary>('last-sync-summary')) ??
      EMPTY_SUMMARY
    const conflicts = await db.listConflicts(true)

    return {
      deviceId: storageDeviceId ?? db.getDeviceId(),
      lastSummary,
      conflicts: conflicts.length > 0 ? conflicts : await storageV2AppDataKvMirrorService.listSyncConflicts(true),
      syncing: Boolean(this.syncInFlight || this.syncBackgroundInFlight),
      syncStartedAt: this.syncStartedAt
    }
  }
}

export const appDataSyncService = AppDataSyncService.getInstance()
