import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

import { loggerService } from '@logger'
import BackupManager from '@main/services/BackupManager'
import { storageV2AppDataKvMirrorService } from '@main/services/storageV2/AppDataKvMirrorService'
import { storageV2AppDataRuntimeRecoveryService } from '@main/services/storageV2/AppDataRuntimeRecoveryService'
import {
  type StorageV2WebDavRecordSyncManifest,
  storageV2WebDavRecordSyncService,
  type StorageV2WebDavRecordSyncSummary
} from '@main/services/storageV2/WebDavRecordSyncService'
import { normalizeWebDavHost, runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import type { WebDavConfig } from '@types'
import { createClient, type FileStat, type WebDAVClient } from 'webdav'

import { type AppDataDatabase, type AppDataRecord, getAppDataDatabase } from './AppDataDatabase'
import { mergeAppDataRecords } from './AppDataRecordMerge'

const logger = loggerService.withContext('AppDataSyncService')

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
  createdAt: string
  uploadedAt: number
  deviceId: string
  format: 'cherry-studio-direct-backup-zip'
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
  skipped: number
  storageUploaded: number
  storageDownloaded: number
  storageDeleted: number
  storageConflicts: number
  storageSkipped: number
  blobUploaded: number
  blobDownloaded: number
  snapshotUploaded: boolean
  snapshotFileName: string | null
  snapshotBytes: number
  lastSyncAt: number
}

const EMPTY_SUMMARY: DataSyncSummary = {
  status: undefined,
  error: null,
  uploaded: 0,
  downloaded: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 0,
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageSkipped: 0,
  blobUploaded: 0,
  blobDownloaded: 0,
  snapshotUploaded: false,
  snapshotFileName: null,
  snapshotBytes: 0,
  lastSyncAt: 0
}

const SNAPSHOT_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000
const DATA_SYNC_REMOTE_ROOT = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'

function recordId(scope: string, key: string) {
  return `${scope}:${key}`
}

function encodePart(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function recordPath(record: Pick<AppDataRecord, 'scope' | 'key'>) {
  return `records/${encodePart(record.scope)}/${encodePart(record.key)}.json`
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
  return { version: 1, updatedAt: Date.now(), records: {}, storageV2: null, latestSnapshot: null, snapshots: {} }
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

function snapshotFileName(deviceId: string) {
  return `cherry-studio-pi.data-sync.${safeFileSegment(deviceId)}.zip`
}

function normalizeRemoteSnapshotPath(value: string) {
  const normalized = path.posix.normalize(value)
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..') {
    throw new Error('Remote data snapshot path is invalid')
  }
  return normalized
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isIgnorableCreateDirectoryError(error: unknown) {
  return error instanceof WebDavOperationError && (error.status === 405 || error.status === 409)
}

export class AppDataSyncService {
  private static instance: AppDataSyncService | null = null
  private readonly backupManager: BackupManager

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
    await runWebDavOperation(
      `writing remote json ${filePath}`,
      () => client.putFileContents(filePath, JSON.stringify(data, null, 2), { overwrite: true }),
      { logger }
    )
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
    nextManifest.records = nextManifest.records ?? {}
    nextManifest.storageV2 = nextManifest.storageV2 ?? null
    nextManifest.snapshots = nextManifest.snapshots ?? {}
    nextManifest.latestSnapshot = nextManifest.latestSnapshot ?? null
    return nextManifest
  }

  private addStorageV2Summary(summary: DataSyncSummary, storageSummary: StorageV2WebDavRecordSyncSummary) {
    summary.storageUploaded += storageSummary.storageUploaded
    summary.storageDownloaded += storageSummary.storageDownloaded
    summary.storageDeleted += storageSummary.storageDeleted
    summary.storageConflicts += storageSummary.storageConflicts
    summary.storageSkipped += storageSummary.storageSkipped
    summary.blobUploaded += storageSummary.blobUploaded
    summary.blobDownloaded += storageSummary.blobDownloaded
  }

  private async pullRemoteRecord(client: WebDAVClient, basePath: string, meta: RemoteRecordMeta) {
    return this.readJson<AppDataRecord>(client, path.posix.join(basePath, meta.path))
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

  private async createConflict(
    db: AppDataDatabase,
    input: {
      scope: string
      key: string
      localRecord?: AppDataRecord
      remoteRecord: AppDataRecord
      baseHash?: string | null
    }
  ) {
    const id = `${input.scope}:${input.key}:${Date.now()}`
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
    const fileName = snapshotFileName(deviceId)
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
      await this.ensureDirectory(client, path.posix.dirname(remotePath))
      await runWebDavOperation(
        `uploading data sync snapshot ${remotePath}`,
        () =>
          client.putFileContents(remotePath, fs.createReadStream(localBackupPath), {
            overwrite: true,
            contentLength: stat.size
          }),
        { logger }
      )

      const snapshot: RemoteSnapshotMeta = {
        id: safeFileSegment(deviceId),
        fileName,
        path: relativePath,
        byteSize: stat.size,
        createdAt: new Date(summary.lastSyncAt).toISOString(),
        uploadedAt: summary.lastSyncAt,
        deviceId,
        format: 'cherry-studio-direct-backup-zip'
      }

      manifest.snapshots = {
        ...(manifest.snapshots ?? {}),
        [snapshot.id]: snapshot
      }
      manifest.latestSnapshot = snapshot

      summary.snapshotUploaded = true
      summary.snapshotFileName = fileName
      summary.snapshotBytes = stat.size
    } finally {
      await fsp.rm(localBackupPath, { force: true }).catch(() => undefined)
    }
  }

  private shouldUploadFullSnapshot(db: AppDataDatabase, manifest: RemoteManifest, now: number) {
    const existingSnapshot = manifest.snapshots?.[safeFileSegment(db.getDeviceId())]
    return !existingSnapshot?.uploadedAt || now - existingSnapshot.uploadedAt >= SNAPSHOT_UPLOAD_INTERVAL_MS
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
      { logger }
    )
    const localBackupPath = path.join(
      process.env.TMPDIR || '/tmp',
      'cherry-studio-pi-data-sync',
      path.basename(snapshot.fileName)
    )
    await fsp.mkdir(path.dirname(localBackupPath), { recursive: true })
    await fsp.writeFile(localBackupPath, bufferFromRemote(backupContents))

    return this.backupManager.restore(undefined as unknown as Electron.IpcMainInvokeEvent, localBackupPath)
  }

  async syncNow(config: WebDavConfig): Promise<DataSyncSummary> {
    if (!normalizeWebDavHost(config.webdavHost)) {
      throw new Error('WebDAV host is required')
    }

    let db = await getAppDataDatabase()
    const { client, basePath } = this.createWebDavClient(config)
    const manifestPath = path.posix.join(basePath, 'manifest.json')
    const summary: DataSyncSummary = { ...EMPTY_SUMMARY, lastSyncAt: Date.now() }

    await this.ensureDirectory(client, basePath)
    await this.assertWriteAccess(client, basePath)

    let localRecords = await db.listRecords(undefined, true)
    if (
      localRecords.length === 0 &&
      (await storageV2AppDataRuntimeRecoveryService.projectIfLegacyAppRecordListEmpty(undefined, 'app-data-sync-empty'))
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
    const manifest = this.normalizeManifest(
      await this.readJson<RemoteManifest>(client, manifestPath, { throwOnInvalidJson: true })
    )
    const allIds = new Set([...localById.keys(), ...Object.keys(manifest.records)])

    for (const id of allIds) {
      const localRecord = localById.get(id)
      const remoteMeta = manifest.records[id]
      const lastHash = await this.getSyncState<string>(db, `record:${id}:hash`)

      if (localRecord && !remoteMeta) {
        await this.pushRecord(client, basePath, localRecord, manifest)
        await this.setSyncState(db, `record:${id}:hash`, localRecord.valueHash)
        summary.uploaded += localRecord.deletedAt ? 0 : 1
        summary.deleted += localRecord.deletedAt ? 1 : 0
        continue
      }

      if (!localRecord && remoteMeta) {
        const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
        if (remoteRecord) {
          await this.applyRemoteRecord(db, remoteRecord)
          await this.setSyncState(db, `record:${id}:hash`, remoteRecord.valueHash)
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
        await this.setSyncState(db, `record:${id}:hash`, localRecord.valueHash)
        summary.skipped += 1
        continue
      }

      const localChanged = localRecord.valueHash !== lastHash
      const remoteChanged = remoteMeta.valueHash !== lastHash

      if (!lastHash) {
        const remoteRecord = await this.pullRemoteRecord(client, basePath, remoteMeta)
        if (remoteRecord) {
          await this.applyRemoteRecord(db, remoteRecord)
          await this.setSyncState(db, `record:${id}:hash`, remoteRecord.valueHash)
          summary.downloaded += remoteRecord.deletedAt ? 0 : 1
          summary.deleted += remoteRecord.deletedAt ? 1 : 0
        } else {
          summary.skipped += 1
        }
        continue
      }

      if (localChanged && !remoteChanged) {
        await this.pushRecord(client, basePath, localRecord, manifest)
        await this.setSyncState(db, `record:${id}:hash`, localRecord.valueHash)
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
        await this.setSyncState(db, `record:${id}:hash`, remoteRecord.valueHash)
        summary.downloaded += remoteRecord.deletedAt ? 0 : 1
        summary.deleted += remoteRecord.deletedAt ? 1 : 0
        continue
      }

      await this.createConflict(db, {
        scope: localRecord.scope,
        key: localRecord.key,
        localRecord,
        remoteRecord,
        baseHash: lastHash
      })

      const winner = localRecord.updatedAt >= remoteRecord.updatedAt ? localRecord : remoteRecord
      if (winner === localRecord) {
        await this.pushRecord(client, basePath, localRecord, manifest)
        summary.uploaded += localRecord.deletedAt ? 0 : 1
      } else {
        await this.applyRemoteRecord(db, remoteRecord)
        summary.downloaded += remoteRecord.deletedAt ? 0 : 1
      }
      await this.setSyncState(db, `record:${id}:hash`, winner.valueHash)
      summary.conflicts += 1
    }

    const storageSync = await storageV2WebDavRecordSyncService.sync(client, basePath, manifest.storageV2)
    manifest.storageV2 = storageSync.manifest
    this.addStorageV2Summary(summary, storageSync.summary)

    manifest.updatedAt = summary.lastSyncAt
    await this.writeJson(client, manifestPath, manifest)

    if (this.shouldUploadFullSnapshot(db, manifest, summary.lastSyncAt)) {
      try {
        await this.pushFullSnapshot(client, basePath, db, manifest, summary)
        manifest.updatedAt = summary.lastSyncAt
        await this.writeJson(client, manifestPath, manifest)
      } catch (error) {
        logger.warn('Data sync safety snapshot upload failed; record sync completed', error as Error)
      }
    }

    summary.status = 'success'
    summary.error = null
    await this.setSyncState(db, 'last-sync-summary', summary)

    return summary
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
      conflicts: conflicts.length > 0 ? conflicts : await storageV2AppDataKvMirrorService.listSyncConflicts(true)
    }
  }
}

export const appDataSyncService = AppDataSyncService.getInstance()
