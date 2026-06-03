import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

import { loggerService } from '@logger'
import BackupManager from '@main/services/BackupManager'
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
import type { WebDavConfig } from '@types'
import { createClient, type FileStat, type WebDAVClient } from 'webdav'

import { type AppDataDatabase, type AppDataRecord, getAppDataDatabase } from './AppDataDatabase'
import { mergeAppDataRecords } from './AppDataRecordMerge'

const logger = loggerService.withContext('AppDataSyncService')
const DATA_SYNC_ALREADY_RUNNING_ERROR = 'Data sync is already running'
const LARGE_WEB_DAV_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000

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
  storageV2?: StorageV2WebDavRecordSyncManifest | null
  latestSnapshot?: RemoteSnapshotMeta | null
  snapshots?: Record<string, RemoteSnapshotMeta>
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
  expiresAt: number
  app: 'cherry-studio-pi'
  reason: 'data-sync'
}

type RemoteSyncLockHandle = {
  type: 'webdav' | 'file'
  path: string
  ownerId: string
  token: string
  previousHeaders?: Record<string, string> | null
}

type RemoteManifestBaseline = {
  existed: boolean
  generation: number
  hash: string | null
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
  remotePath: string | null
  remoteGeneration: number | null
  remoteManifestHash: string | null
  storageBundleHash: string | null
  storageRecordCount: number
  storageBlobCount: number
  lastSyncAt: number
}

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
  remotePath: null,
  remoteGeneration: null,
  remoteManifestHash: null,
  storageBundleHash: null,
  storageRecordCount: 0,
  storageBlobCount: 0,
  lastSyncAt: 0
}

const SNAPSHOT_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000
const DATA_SYNC_REMOTE_ROOT = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'
const STORAGE_V2_RUNTIME_PROJECTION_HASH_KEY = 'storage-v2-runtime-projection-hash'
const REMOTE_SYNC_LOCK_FILE = '.sync.lock.json'
const REMOTE_SYNC_LOCK_TTL_MS = 30 * 60 * 1000
const REMOTE_SYNC_LOCK_RENEW_INTERVAL_MS = Math.max(60_000, Math.floor(REMOTE_SYNC_LOCK_TTL_MS / 3))
const SNAPSHOT_RETENTION_PER_DEVICE = 3
const SNAPSHOT_RETENTION_TOTAL = 20
const NATIVE_WEB_DAV_LOCK_UNSUPPORTED_STATUSES = new Set([403, 405, 409, 501])

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
    storageV2: null,
    latestSnapshot: null,
    snapshots: {}
  }
}

function bufferToString(value: string | Buffer | ArrayBuffer | unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString('utf8')
  }

  return String(value)
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

  return Buffer.from(String(value))
}

function safeFileSegment(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'device'
}

function snapshotFileName(deviceId: string, uploadedAt: number) {
  return `cherry-studio-pi.data-sync.${safeFileSegment(deviceId)}.${uploadedAt}.zip`
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

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await fsp.readFile(filePath))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isIgnorableCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && (error.status === 405 || error.status === 409)
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

function getStorageV2ManifestEntityTypes(manifest?: StorageV2WebDavRecordSyncManifest | null) {
  return new Set(storageV2ManifestRecordEntries(manifest).map(([, meta]) => meta.entityType))
}

export class AppDataSyncService {
  private static instance: AppDataSyncService | null = null
  private readonly backupManager: BackupManager
  private syncInFlight: Promise<DataSyncSummary> | null = null
  private syncStartedAt: number | null = null

  constructor(backupManager = new BackupManager()) {
    this.backupManager = backupManager
  }

  static getInstance() {
    if (!AppDataSyncService.instance) {
      AppDataSyncService.instance = new AppDataSyncService()
    }

    return AppDataSyncService.instance
  }

  private createWebDavClient(config: WebDavConfig) {
    const webdavHost = normalizeWebDavHost(config.webdavHost)
    const client = createClient(webdavHost, {
      username: config.webdavUser,
      password: config.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

    return {
      client,
      basePath: normalizeBasePath(config.webdavPath)
    }
  }

  private createRawWebDavClient(config: WebDavConfig) {
    return createClient(normalizeWebDavHost(config.webdavHost), {
      username: config.webdavUser,
      password: config.webdavPass,
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
      throw error
    }
  }

  private async assertWriteAccess(client: WebDAVClient, basePath: string) {
    const probePath = path.posix.join(basePath, `.cherry-studio-pi-write-test-${Date.now()}.tmp`)
    await runWebDavOperation(
      `writing remote sync probe ${probePath}`,
      () => client.putFileContents(probePath, 'ok', { overwrite: true }),
      { logger }
    )

    const maybeDeleteFile = (client as WebDAVClient & { deleteFile?: (filePath: string) => Promise<void> }).deleteFile
    if (typeof maybeDeleteFile !== 'function') {
      return
    }

    await runWebDavOperation(`deleting remote sync probe ${probePath}`, () => maybeDeleteFile.call(client, probePath), {
      logger
    }).catch((error) => {
      logger.warn(`Failed to delete remote sync probe ${probePath}`, error as Error)
    })
  }

  private async readJson<T>(
    client: WebDAVClient,
    filePath: string,
    options: { throwOnInvalidJson?: boolean } = {}
  ): Promise<T | null> {
    try {
      if (!(await runWebDavOperation(`checking remote json ${filePath}`, () => client.exists(filePath), { logger }))) {
        return null
      }

      const contents = await runWebDavOperation(
        `reading remote json ${filePath}`,
        () => client.getFileContents(filePath, { format: 'binary' }),
        { logger }
      )
      try {
        return JSON.parse(bufferToString(contents)) as T
      } catch (error) {
        if (options.throwOnInvalidJson) {
          throw new Error(`Remote sync metadata is corrupted: ${filePath}`, { cause: error })
        }
        throw error
      }
    } catch (error) {
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
    if (typeof deleteFile !== 'function') return

    await runWebDavOperation(`deleting remote file ${filePath}`, () => deleteFile.call(client, filePath), {
      logger
    }).catch((error) => {
      if (error instanceof WebDavOperationError && error.status === 404) return
      throw error
    })
  }

  private async listRemoteFilesRecursive(client: WebDAVClient, dirPath: string): Promise<string[]> {
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

    for (const entry of entries) {
      const filename = entry.filename || path.posix.join(dirPath, entry.basename || '')
      if (!filename || filename === dirPath) continue
      const normalizedFilename = path.posix.normalize(filename)
      if (normalizedFilename !== normalizedDirPath && !normalizedFilename.startsWith(`${normalizedDirPath}/`)) continue

      if (entry.type === 'directory') {
        files.push(...(await this.listRemoteFilesRecursive(client, normalizedFilename)))
      } else {
        files.push(normalizedFilename)
      }
    }

    return files
  }

  private async pruneRemoteAppDataArtifacts(client: WebDAVClient, basePath: string, manifest: RemoteManifest) {
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

    for (const root of ['records', 'backups']) {
      const files = await this.listRemoteFilesRecursive(client, path.posix.join(basePath, root))
      for (const filePath of files) {
        if (referenced.has(filePath)) continue
        await this.removeRemoteFile(client, filePath)
      }
    }
  }

  private normalizeRemoteLock(lock: RemoteSyncLock | null): RemoteSyncLock | null {
    if (!lock || lock.version !== 1 || !lock.ownerId || !lock.token) return null

    return {
      version: 1,
      ownerId: String(lock.ownerId),
      token: String(lock.token),
      createdAt: Number(lock.createdAt) || 0,
      expiresAt: Number(lock.expiresAt) || 0,
      app: 'cherry-studio-pi',
      reason: 'data-sync'
    }
  }

  private isRemoteLockExpired(lock: RemoteSyncLock, now = Date.now()) {
    return !lock.expiresAt || lock.expiresAt <= now
  }

  private formatRemoteLockMessage(lock: RemoteSyncLock) {
    const createdAt = lock.createdAt ? new Date(lock.createdAt).toLocaleString('zh-CN') : '未知时间'
    const expiresAt = lock.expiresAt ? new Date(lock.expiresAt).toLocaleString('zh-CN') : '未知时间'
    return `另一台设备正在同步这个 WebDAV 目录（设备：${lock.ownerId}，开始：${createdAt}，锁过期：${expiresAt}）。请等待它完成后再试；如果确认没有设备在同步，软件会在锁过期后自动清理。`
  }

  private async readRemoteLock(client: WebDAVClient, lockPath: string) {
    try {
      return this.normalizeRemoteLock(
        await this.readJson<RemoteSyncLock>(client, lockPath, {
          throwOnInvalidJson: true
        })
      )
    } catch (error) {
      throw new Error(`远端同步锁读取失败。为避免破坏远端数据，本次同步已停止：${errorMessage(error)}`)
    }
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
          ...(previousHeaders ?? {}),
          If: this.formatNativeWebDavLockHeader(lock.token)
        })
      }

      return {
        type: 'webdav',
        path: basePath,
        ownerId,
        token: lock.token,
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
    ownerId: string
  ): Promise<RemoteSyncLockHandle> {
    const nativeLock = await this.acquireNativeWebDavLock(client, basePath, ownerId)
    if (nativeLock) return nativeLock

    const lockPath = path.posix.join(basePath, REMOTE_SYNC_LOCK_FILE)
    const token = randomUUID()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = Date.now()
      const lock: RemoteSyncLock = {
        version: 1,
        ownerId,
        token,
        createdAt: now,
        expiresAt: now + REMOTE_SYNC_LOCK_TTL_MS,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      }

      let created = false
      try {
        created = await runWebDavOperation(
          `creating remote data sync lock ${lockPath}`,
          () => client.putFileContents(lockPath, JSON.stringify(lock, null, 2), { overwrite: false }),
          { logger }
        )
      } catch (error) {
        if (error instanceof WebDavOperationError && error.transient) throw error
        if (error instanceof WebDavOperationError && error.status && ![409, 412, 423].includes(error.status)) {
          throw error
        }
        logger.warn('Failed to create remote data sync lock; inspecting existing lock', error as Error)
      }

      if (created) {
        const remoteLock = await this.readRemoteLock(client, lockPath)
        if (remoteLock?.token === token && remoteLock.ownerId === ownerId) {
          return { type: 'file', path: lockPath, ownerId, token }
        }
      }

      const existingLock = await this.readRemoteLock(client, lockPath)
      if (!existingLock) continue

      if (!this.isRemoteLockExpired(existingLock)) {
        throw new Error(this.formatRemoteLockMessage(existingLock))
      }

      logger.warn('Removing expired remote data sync lock', existingLock)
      await this.removeRemoteFile(client, lockPath)
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

  private startRemoteLockRenewal(client: WebDAVClient, lock: RemoteSyncLockHandle | null) {
    let stopped = false
    let renewalError: unknown = null
    if (!lock || lock.type !== 'file') {
      return {
        stop: () => undefined,
        getError: () => renewalError
      }
    }

    const renew = async () => {
      try {
        const remoteLock = await this.readRemoteLock(client, lock.path)
        if (!remoteLock || remoteLock.token !== lock.token || remoteLock.ownerId !== lock.ownerId) {
          throw new Error('远端同步锁已被其他设备接管')
        }

        const renewedLock: RemoteSyncLock = {
          ...remoteLock,
          expiresAt: Date.now() + REMOTE_SYNC_LOCK_TTL_MS
        }
        await runWebDavOperation(
          `renewing remote data sync lock ${lock.path}`,
          () => client.putFileContents(lock.path, JSON.stringify(renewedLock, null, 2), { overwrite: true }),
          { logger }
        )
      } catch (error) {
        renewalError = error
        logger.warn('Failed to renew remote data sync lock', error as Error)
      }
    }

    const interval = setInterval(() => {
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
        clearInterval(interval)
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
  }

  async listRemoteDirectories(config: WebDavConfig, remotePath = '/'): Promise<DataSyncRemoteDirectoryList> {
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    const client = this.createRawWebDavClient(config)
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
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    const { client, basePath } = this.createWebDavClient(config)
    await this.ensureDirectory(client, basePath)
    await this.assertWriteAccess(client, basePath)

    return { ok: true, basePath }
  }

  private normalizeManifest(manifest: RemoteManifest | null): RemoteManifest {
    const nextManifest = manifest ?? makeManifest()
    nextManifest.generation = Number.isFinite(nextManifest.generation) ? Number(nextManifest.generation) : 0
    nextManifest.records = nextManifest.records ?? {}
    nextManifest.storageV2 = nextManifest.storageV2 ?? null
    nextManifest.snapshots = nextManifest.snapshots ?? {}
    nextManifest.latestSnapshot = nextManifest.latestSnapshot ?? null
    return nextManifest
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
    const latestRawManifest = await this.readJson<RemoteManifest>(client, manifestPath, { throwOnInvalidJson: true })
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
    const record = await this.readJson<AppDataRecord>(client, remotePath)
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
    if (input.resolvedAt) {
      return null
    }

    const id = `${input.scope}:${input.key}:${hashJsonValue({
      baseHash: input.baseHash ?? null,
      localHash: input.localRecord?.valueHash ?? null,
      remoteHash: input.remoteRecord.valueHash
    }).slice(0, 32)}`
    await storageV2AppDataKvMirrorService.upsertSyncConflict(id, input)
    await db.createConflict({ ...input, id }, { storageV2Mirrored: true })
    return id
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
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    const db = await getAppDataDatabase()
    const { client, basePath } = this.createWebDavClient(config)
    const manifestPath = path.posix.join(basePath, 'manifest.json')
    const manifest = this.normalizeManifest(
      await this.readJson<RemoteManifest>(client, manifestPath, { throwOnInvalidJson: true })
    )
    const localDeviceId = db.getDeviceId()
    const snapshots = Object.values(manifest.snapshots ?? {})
      .filter((snapshot): snapshot is RemoteSnapshotMeta => Boolean(snapshot?.path && snapshot.fileName))
      .sort((left, right) => right.uploadedAt - left.uploadedAt)
    const snapshot =
      snapshots.find((item) => item.deviceId !== localDeviceId) ?? manifest.latestSnapshot ?? snapshots[0] ?? null

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
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    if (this.syncInFlight) {
      throw new Error(DATA_SYNC_ALREADY_RUNNING_ERROR)
    }

    this.syncStartedAt = Date.now()
    const sync = this.performSyncNow(config)
    this.syncInFlight = sync

    try {
      return await sync
    } finally {
      if (this.syncInFlight === sync) {
        this.syncInFlight = null
        this.syncStartedAt = null
      }
    }
  }

  private async performSyncNow(config: WebDavConfig): Promise<DataSyncSummary> {
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    let db = await getAppDataDatabase()
    const { client, basePath } = this.createWebDavClient(config)
    const manifestPath = path.posix.join(basePath, 'manifest.json')
    const summary: DataSyncSummary = { ...EMPTY_SUMMARY, remotePath: basePath, lastSyncAt: Date.now() }
    const pendingSyncStates = new Map<string, unknown>()
    const stageSyncState = (id: string, value: unknown) => {
      pendingSyncStates.set(id, value)
    }
    let storageSyncStates: StorageV2WebDavRecordSyncStateCommit[] = []

    await this.ensureDirectory(client, basePath)
    const remoteLock = await this.acquireRemoteLock(client, basePath, db.getDeviceId())
    const lockRenewal = this.startRemoteLockRenewal(client, remoteLock)
    try {
      await this.assertWriteAccess(client, basePath)

      let localRecords = await db.listRecords(undefined, true)
      if (
        localRecords.length === 0 &&
        (await storageV2AppDataRuntimeRecoveryService.projectIfLegacyAppRecordListEmpty(
          undefined,
          'app-data-sync-empty'
        ))
      ) {
        db = await getAppDataDatabase()
        localRecords = await db.listRecords(undefined, true)
      }
      if (localRecords.length === 0) {
        localRecords = await storageV2AppDataKvMirrorService.listRecords(undefined, true)
      } else {
        try {
          const storageRecords = await storageV2AppDataKvMirrorService.listRecords(undefined, true)
          localRecords = mergeAppDataRecords(localRecords, storageRecords)
        } catch (error) {
          logger.warn('Failed to merge Storage v2 app records into sync source', error as Error)
        }
      }
      const localById = new Map(localRecords.map((record) => [recordId(record.scope, record.key), record]))
      const rawManifest = await this.readJson<RemoteManifest>(client, manifestPath, { throwOnInvalidJson: true })
      const manifest = this.normalizeManifest(rawManifest)
      const manifestBaseline = this.captureManifestBaseline(rawManifest, manifest)
      const remoteHadStorageDataBeforeSync = hasStorageV2RemoteData(manifest.storageV2)
      const allIds = new Set([...localById.keys(), ...Object.keys(manifest.records)])

      for (const id of allIds) {
        const localRecord = localById.get(id)
        const remoteMeta = manifest.records[id]
        const lastHash = await this.getSyncState<string>(db, `record:${id}:hash`)

        if (localRecord && !remoteMeta) {
          await this.pushRecord(client, basePath, localRecord, manifest)
          stageSyncState(`record:${id}:hash`, localRecord.valueHash)
          summary.uploaded += localRecord.deletedAt ? 0 : 1
          summary.deleted += localRecord.deletedAt ? 1 : 0
          continue
        }

        if (!localRecord && remoteMeta) {
          const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
          if (remoteRecord) {
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

        const localChanged = localRecord.valueHash !== lastHash
        const remoteChanged = remoteMeta.valueHash !== lastHash

        if (!lastHash) {
          const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
          if (remoteRecord) {
            await this.applyRemoteRecord(db, remoteRecord)
            stageSyncState(`record:${id}:hash`, remoteRecord.valueHash)
            summary.downloaded += remoteRecord.deletedAt ? 0 : 1
            summary.deleted += remoteRecord.deletedAt ? 1 : 0
          } else {
            summary.skipped += 1
          }
          continue
        }

        if (localChanged && !remoteChanged) {
          await this.pushRecord(client, basePath, localRecord, manifest)
          stageSyncState(`record:${id}:hash`, localRecord.valueHash)
          summary.uploaded += localRecord.deletedAt ? 0 : 1
          summary.deleted += localRecord.deletedAt ? 1 : 0
          continue
        }

        const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
        if (!remoteRecord) {
          summary.skipped += 1
          continue
        }

        if (!localChanged && remoteChanged) {
          await this.applyRemoteRecord(db, remoteRecord)
          stageSyncState(`record:${id}:hash`, remoteRecord.valueHash)
          summary.downloaded += remoteRecord.deletedAt ? 0 : 1
          summary.deleted += remoteRecord.deletedAt ? 1 : 0
          continue
        }

        const unresolvedConflict =
          localRecord.updatedAt === remoteRecord.updatedAt && localRecord.version === remoteRecord.version
        if (unresolvedConflict) {
          await this.createConflict(db, {
            scope: localRecord.scope,
            key: localRecord.key,
            localRecord,
            remoteRecord,
            baseHash: lastHash
          })
          summary.conflicts += 1
        } else {
          await this.createConflict(db, {
            scope: localRecord.scope,
            key: localRecord.key,
            localRecord,
            remoteRecord,
            baseHash: lastHash,
            resolvedAt: Date.now()
          })
          summary.resolvedConflicts += 1
        }

        const winner =
          localRecord.updatedAt > remoteRecord.updatedAt ||
          (localRecord.updatedAt === remoteRecord.updatedAt && localRecord.version >= remoteRecord.version)
            ? localRecord
            : remoteRecord
        if (winner === localRecord) {
          await this.pushRecord(client, basePath, localRecord, manifest)
          summary.uploaded += localRecord.deletedAt ? 0 : 1
        } else {
          await this.applyRemoteRecord(db, remoteRecord)
          summary.downloaded += remoteRecord.deletedAt ? 0 : 1
        }
        stageSyncState(`record:${id}:hash`, winner.valueHash)
      }

      const storageSync = await storageV2WebDavRecordSyncService.sync(client, basePath, manifest.storageV2, {
        secretKeyMaterial: `${normalizeWebDavHost(config.webdavHost)}\n${config.webdavUser ?? ''}\n${config.webdavPass ?? ''}`
      })
      manifest.storageV2 = storageSync.manifest
      storageSyncStates = storageSync.syncStates ?? []
      this.addStorageV2Summary(summary, storageSync.summary)
      db = await this.projectStorageV2RuntimeAfterSync(db, manifest.storageV2, summary, {
        remoteHadStorageDataBeforeSync
      })

      if (this.shouldUploadFullSnapshot(db, manifest, summary.lastSyncAt)) {
        try {
          await this.pushFullSnapshot(client, basePath, db, manifest, summary)
        } catch (error) {
          throw new Error(
            `安全快照上传失败。为避免发布缺少兜底恢复点的同步状态，本次同步已停止：${errorMessage(error)}`
          )
        }
      }

      manifest.updatedAt = summary.lastSyncAt
      manifest.generation = manifestBaseline.generation + 1
      this.updateSummaryRemoteState(summary, manifest)
      const renewalError = lockRenewal.getError()
      if (renewalError) {
        throw new Error(
          `远端同步锁续租失败。为避免长时间同步后覆盖其他设备的数据，本次同步已停止：${errorMessage(renewalError)}`
        )
      }
      await this.assertRemoteLockStillOwned(client, remoteLock)
      await this.assertRemoteManifestUnchanged(client, manifestPath, manifestBaseline)
      await this.writeJson(client, manifestPath, manifest)
      await this.pruneRemoteAppDataArtifacts(client, basePath, manifest).catch((error) => {
        logger.warn('Failed to prune stale app data WebDAV artifacts after sync', error as Error)
      })
      await storageV2WebDavRecordSyncService.commitRecordSyncStates(storageSyncStates)
      await storageV2WebDavRecordSyncService
        .pruneRemoteArtifacts(client, basePath, manifest.storageV2)
        .catch((error) => {
          logger.warn('Failed to prune stale Storage v2 WebDAV artifacts after sync', error as Error)
        })
      for (const [id, value] of pendingSyncStates) {
        await this.setSyncState(db, id, value)
      }

      summary.status = 'success'
      summary.error = null
      await this.setSyncState(db, 'last-sync-summary', summary)

      return summary
    } finally {
      lockRenewal.stop()
      await this.releaseRemoteLock(client, remoteLock)
    }
  }

  async recordSyncFailure(error: unknown) {
    const db = await getAppDataDatabase()
    const summary: DataSyncSummary = {
      ...EMPTY_SUMMARY,
      status: 'failed',
      error: errorMessage(error),
      lastSyncAt: Date.now()
    }
    await this.setSyncState(db, 'last-sync-summary', summary)
    return summary
  }

  async getStatus() {
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
      syncing: Boolean(this.syncInFlight),
      syncStartedAt: this.syncStartedAt
    }
  }
}

export const appDataSyncService = AppDataSyncService.getInstance()
