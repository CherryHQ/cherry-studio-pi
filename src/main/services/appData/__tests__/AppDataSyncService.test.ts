import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'

import type { WebDavConfig } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')

const mocks = vi.hoisted(() => ({
  db: {
    listRecords: vi.fn(),
    getSyncState: vi.fn(),
    setSyncState: vi.fn(),
    applyRemoteRecord: vi.fn(),
    createConflict: vi.fn(),
    getDeviceId: vi.fn(),
    listConflicts: vi.fn()
  },
  storageV2: {
    upsertRecordSnapshot: vi.fn(),
    upsertSyncState: vi.fn(),
    getSyncState: vi.fn(),
    upsertSyncConflict: vi.fn(),
    listSyncConflicts: vi.fn(),
    listRecords: vi.fn()
  },
  recovery: {
    projectIfLegacyAppRecordListEmpty: vi.fn()
  },
  runtimeProjection: {
    projectAgents: vi.fn(),
    projectFiles: vi.fn(),
    projectAppData: vi.fn()
  },
  dataRoot: {
    ensureDataRoot: vi.fn()
  },
  storageRecordSync: {
    sync: vi.fn(),
    commitRecordSyncStates: vi.fn(),
    pruneRemoteArtifacts: vi.fn()
  },
  runtimeFlush: {
    flushMainStorageV2RuntimeMirrors: vi.fn()
  },
  powerSaveBlocker: {
    runWithBlocker: vi.fn(async (_reason: string, task: () => Promise<unknown>) => task())
  },
  backupManager: {
    backup: vi.fn(),
    restore: vi.fn()
  },
  preferenceService: {
    get: vi.fn()
  },
  notesDir: '/tmp/cherry-studio-pi-app-data-sync-service-notes',
  configuredNotesDir: '/tmp/cherry-studio-pi-app-data-sync-service-configured-notes',
  runtimeDataRoot: '/tmp/cherry-studio-pi-app-data-sync-service-runtime',
  memory: {
    close: vi.fn()
  },
  remoteFiles: new Map<string, unknown>(),
  webdav: {
    exists: vi.fn(),
    stat: vi.fn(),
    createDirectory: vi.fn(),
    getFileContents: vi.fn(),
    putFileContents: vi.fn(),
    deleteFile: vi.fn(),
    getDirectoryContents: vi.fn(),
    customRequest: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    getHeaders: vi.fn(),
    setHeaders: vi.fn()
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

vi.mock('@application', () => ({
  application: {
    get: (serviceName: string) => {
      if (serviceName === 'PreferenceService') return mocks.preferenceService
      throw new Error(`Unexpected service: ${serviceName}`)
    }
  }
}))

vi.mock('@main/services/BackupManager', () => ({
  default: vi.fn(() => mocks.backupManager)
}))

vi.mock('@main/services/AppRuntimeSaveService', () => ({
  flushMainStorageV2RuntimeMirrors: mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors
}))

vi.mock('@main/services/memory/MemoryService', () => ({
  default: {
    getInstance: () => mocks.memory
  }
}))

vi.mock('webdav', () => ({
  createClient: vi.fn(() => mocks.webdav)
}))

vi.mock('../AppDataDatabase', () => ({
  getAppDataDatabase: vi.fn(async () => mocks.db)
}))

vi.mock('@main/services/storageV2/AppDataKvMirrorService', () => ({
  storageV2AppDataKvMirrorService: mocks.storageV2
}))

vi.mock('@main/services/storageV2/AppDataRuntimeRecoveryService', () => ({
  storageV2AppDataRuntimeRecoveryService: mocks.recovery
}))

vi.mock('@main/services/storageV2/AgentLegacyProjectionService', () => ({
  storageV2AgentLegacyProjectionService: {
    projectToLegacyRuntime: mocks.runtimeProjection.projectAgents
  }
}))

vi.mock('@main/services/storageV2/FileLegacyProjectionService', () => ({
  storageV2FileLegacyProjectionService: {
    projectToLegacyRuntime: mocks.runtimeProjection.projectFiles
  }
}))

vi.mock('@main/services/storageV2/AppDataLegacyProjectionService', () => ({
  storageV2AppDataLegacyProjectionService: {
    projectToLegacyRuntime: mocks.runtimeProjection.projectAppData
  }
}))

vi.mock('@main/services/storageV2/DataRootService', () => ({
  storageV2DataRootService: mocks.dataRoot
}))

vi.mock('@main/services/storageV2/WebDavRecordSyncService', () => ({
  storageV2WebDavRecordSyncService: mocks.storageRecordSync
}))

vi.mock('@main/services/PowerSaveBlockerService', () => ({
  default: mocks.powerSaveBlocker,
  powerSaveBlockerService: mocks.powerSaveBlocker
}))

vi.mock('@main/utils', () => ({
  getDataPath: (subPath?: string) => (subPath ? path.join(mocks.runtimeDataRoot, subPath) : mocks.runtimeDataRoot)
}))

vi.mock('@main/utils/file', () => ({
  getNotesDir: () => mocks.notesDir
}))

import { createClient } from 'webdav'

import { AppDataSyncService } from '../AppDataSyncService'

const config: WebDavConfig = {
  webdavHost: 'https://dav.example.com',
  webdavUser: 'user',
  webdavPass: 'pass',
  webdavPath: '/remote-root'
}

async function normalizeUploadedContents(contents: unknown) {
  if (contents && typeof (contents as any).on === 'function' && typeof (contents as any).read === 'function') {
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = contents as {
        on: (event: string, handler: (chunk?: Buffer | string | Uint8Array | Error) => void) => void
      }
      stream.on('data', (chunk) => {
        if (chunk instanceof Error) return
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? ''))
      })
      stream.on('end', () => resolve())
      stream.on('error', (error) => reject(error))
    })
    return Buffer.concat(chunks)
  }

  if (contents instanceof Readable || (contents && typeof (contents as any)[Symbol.asyncIterator] === 'function')) {
    const chunks: Buffer[] = []
    for await (const chunk of contents as AsyncIterable<Buffer | string | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  if (contents && typeof (contents as any).on === 'function') {
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = contents as {
        on: (event: string, handler: (chunk?: Buffer | string | Uint8Array | Error) => void) => void
      }
      stream.on('data', (chunk) => {
        if (chunk instanceof Error) return
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? ''))
      })
      stream.on('end', () => resolve())
      stream.on('error', (error) => reject(error))
    })
    return Buffer.concat(chunks)
  }

  return contents
}

async function pathExists(filePath: string) {
  return Boolean(await fsp.stat(filePath).catch(() => null))
}

const remoteRecord = {
  scope: 'settings',
  key: 'theme',
  value: { mode: 'dark' },
  valueHash: 'remote-hash',
  updatedAt: 1760000000000,
  deletedAt: null,
  deviceId: 'remote-device',
  version: 3
}

const remoteManifest = {
  version: 1,
  updatedAt: 1760000000000,
  records: {
    'settings:theme': {
      scope: remoteRecord.scope,
      key: remoteRecord.key,
      valueHash: remoteRecord.valueHash,
      updatedAt: remoteRecord.updatedAt,
      deletedAt: remoteRecord.deletedAt,
      deviceId: remoteRecord.deviceId,
      version: remoteRecord.version,
      path: 'records/settings/theme.json'
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

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

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function notesRemotePath(relativePath: string, valueHash: string) {
  const pathHash = createHash('sha256').update(relativePath).digest('hex')
  return `notes/files/${pathHash.slice(0, 2)}/${pathHash}/${valueHash}.bin`
}

function notesSyncStateKey(deviceId: string, relativePath: string) {
  return `notes-file:${createHash('sha256').update(`${deviceId}\0${relativePath}`).digest('hex')}`
}

function runtimeDirectorySyncStateKey(deviceId: string, name: string) {
  return `runtime-directory:${createHash('sha256').update(`${deviceId}\0${name}`).digest('hex')}`
}

function createRuntimeDirectoryBundle(input: {
  name: 'Memory' | 'Skills' | 'MCP' | 'Channels'
  relativePath: string
  content: string
  updatedAt: number
  mode?: number
}) {
  const content = Buffer.from(input.content, 'utf8')
  const mode = input.mode ?? 0o644
  const file = {
    relativePath: input.relativePath,
    valueHash: sha256Buffer(content),
    byteSize: content.byteLength,
    updatedAt: input.updatedAt,
    mode,
    contentBase64: content.toString('base64')
  }
  const valueHash = hashJson([[file.relativePath, file.valueHash, file.byteSize, file.mode]])
  const bundle = {
    version: 1,
    name: input.name,
    updatedAt: input.updatedAt,
    files: {
      [input.relativePath]: file
    }
  }
  const compressed = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'), { level: 9 })

  return {
    valueHash,
    byteSize: file.byteSize,
    compressed,
    fileCount: 1
  }
}

function mockDirectoryContentsFromRemoteFiles() {
  mocks.webdav.getDirectoryContents.mockImplementation(async (dirPath: string) => {
    const normalized = path.posix.normalize(dirPath).replace(/\/+$/g, '')
    const prefix = `${normalized}/`
    const discoveredDirectories = new Set<string>()
    const entries: Array<{ type: 'directory' | 'file'; basename: string; filename: string; lastmod: string }> = []

    for (const key of mocks.remoteFiles.keys()) {
      const filePath = path.posix.normalize(String(key))
      if (!filePath.startsWith(prefix)) continue

      const relativePath = filePath.slice(prefix.length)
      const parts = relativePath.split('/')
      if (!parts[0]) continue

      if (parts.length === 1) {
        entries.push({
          type: 'file',
          basename: parts[0],
          filename: filePath,
          lastmod: '2026-06-01T00:00:00.000Z'
        })
        continue
      }

      const childDir = `${normalized}/${parts[0]}`
      if (discoveredDirectories.has(childDir)) continue
      discoveredDirectories.add(childDir)
      entries.push({
        type: 'directory',
        basename: parts[0],
        filename: childDir,
        lastmod: '2026-06-01T00:00:00.000Z'
      })
    }

    return entries
  })
}

describe('AppDataSyncService', () => {
  afterEach(async () => {
    const tempEntries = await fsp.readdir('/tmp').catch(() => [])
    await Promise.all(
      tempEntries
        .filter((entry) => /^cherry-studio-pi\.data-sync\..+\.zip$/.test(entry))
        .map((entry) => fsp.rm(path.join('/tmp', entry), { force: true }))
    )
  })

  beforeEach(async () => {
    vi.useRealTimers()
    vi.clearAllMocks()
    delete process.env.CHERRY_STUDIO_DATA_SYNC_REMOTE_SNAPSHOT
    delete process.env.CHERRY_STUDIO_DATA_SYNC_LOCAL_SAFETY_SNAPSHOT
    delete process.env.CHERRY_STUDIO_DATA_SYNC_MAX_RUNTIME_MS
    delete process.env.CHERRY_STUDIO_DATA_SYNC_CLEANUP_MAX_FILES
    await fsp.rm(mocks.notesDir, { recursive: true, force: true })
    await fsp.rm(mocks.configuredNotesDir, { recursive: true, force: true })
    await fsp.rm(mocks.runtimeDataRoot, { recursive: true, force: true })
    mocks.remoteFiles.clear()
    mocks.memory.close.mockResolvedValue(undefined)
    mocks.db.listRecords.mockResolvedValue([])
    mocks.db.getSyncState.mockResolvedValue(null)
    mocks.db.setSyncState.mockResolvedValue(undefined)
    mocks.db.applyRemoteRecord.mockResolvedValue(undefined)
    mocks.db.createConflict.mockResolvedValue('settings:theme:1760000000000')
    mocks.db.getDeviceId.mockReturnValue('local-device')
    mocks.db.listConflicts.mockResolvedValue([])
    mocks.storageV2.upsertRecordSnapshot.mockResolvedValue(undefined)
    mocks.storageV2.upsertSyncState.mockResolvedValue(undefined)
    mocks.storageV2.getSyncState.mockResolvedValue(null)
    mocks.storageV2.upsertSyncConflict.mockResolvedValue(undefined)
    mocks.storageV2.listSyncConflicts.mockResolvedValue([])
    mocks.storageV2.listRecords.mockResolvedValue([])
    mocks.recovery.projectIfLegacyAppRecordListEmpty.mockResolvedValue(false)
    mocks.runtimeProjection.projectAgents.mockResolvedValue({ projectedAgentCount: 0 })
    mocks.runtimeProjection.projectFiles.mockResolvedValue({ projectedFileCount: 0 })
    mocks.runtimeProjection.projectAppData.mockResolvedValue({ projectedRecordCount: 0 })
    mocks.dataRoot.ensureDataRoot.mockReturnValue({ dataRoot: '/tmp/cherry-studio-pi-data-root' })
    mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mockResolvedValue(undefined)
    mocks.storageRecordSync.sync.mockResolvedValue({
      manifest: { version: 1, records: {}, blobs: {} },
      syncStates: [],
      summary: {
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
    })
    mocks.storageRecordSync.commitRecordSyncStates.mockResolvedValue(undefined)
    mocks.storageRecordSync.pruneRemoteArtifacts.mockResolvedValue(undefined)
    mocks.powerSaveBlocker.runWithBlocker.mockImplementation(async (_reason: string, task: () => Promise<unknown>) =>
      task()
    )
    mocks.backupManager.backup.mockImplementation(async (_event, fileName: string) => {
      const filePath = path.join('/tmp', fileName)
      await fsp.writeFile(filePath, 'backup')
      return filePath
    })
    mocks.backupManager.restore.mockResolvedValue(undefined)
    mocks.preferenceService.get.mockReturnValue('')
    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      if (String(filePath).endsWith('/.sync.lock.json')) {
        return mocks.remoteFiles.has(filePath)
      }
      if (mocks.remoteFiles.has(filePath)) return true
      return true
    })
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      const value = mocks.remoteFiles.get(filePath)
      if (Buffer.isBuffer(value)) return { size: value.byteLength }
      if (typeof value === 'string') return { size: Buffer.byteLength(value, 'utf8') }
      if (value instanceof ArrayBuffer) return { size: value.byteLength }
      if (ArrayBuffer.isView(value)) return { size: value.byteLength }
      return { size: value == null ? 0 : Buffer.byteLength(String(value), 'utf8') }
    })
    mocks.webdav.createDirectory.mockResolvedValue(undefined)
    mocks.webdav.lock.mockResolvedValue({ token: 'opaquelocktoken:native-lock', serverTimeout: 'Second-1800' })
    mocks.webdav.unlock.mockResolvedValue(undefined)
    mocks.webdav.getHeaders.mockReturnValue({ Authorization: 'Basic token' })
    mocks.webdav.setHeaders.mockResolvedValue(undefined)
    mocks.webdav.putFileContents.mockImplementation(async (filePath: string, contents: unknown, options?: any) => {
      if (options?.overwrite === false && mocks.remoteFiles.has(filePath)) {
        return false
      }
      mocks.remoteFiles.set(filePath, await normalizeUploadedContents(contents))
      return true
    })
    mocks.webdav.deleteFile.mockImplementation(async (filePath: string) => {
      mocks.remoteFiles.delete(filePath)
      const normalized = path.posix.normalize(filePath).replace(/\/+$/g, '')
      for (const key of Array.from(mocks.remoteFiles.keys())) {
        const remotePath = path.posix.normalize(String(key))
        if (remotePath.startsWith(`${normalized}/`)) {
          mocks.remoteFiles.delete(key)
        }
      }
    })
    mocks.webdav.getDirectoryContents.mockResolvedValue([
      {
        type: 'directory',
        basename: 'Cherry',
        filename: '/remote-root/Cherry',
        lastmod: '2026-05-29T00:00:00.000Z'
      },
      {
        type: 'file',
        basename: 'manifest.json',
        filename: '/remote-root/manifest.json',
        lastmod: '2026-05-29T00:00:00.000Z'
      }
    ])
    mocks.webdav.customRequest.mockResolvedValue({
      text: async () => '<d:multistatus xmlns:d="DAV:" />'
    })
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify(remoteManifest)
      }

      if (filePath.endsWith('/records/settings/theme.json')) {
        return JSON.stringify(remoteRecord)
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
  })

  it('lists remote WebDAV directories for the setup browser', async () => {
    const result = await new AppDataSyncService().listRemoteDirectories(config, '/remote-root')

    expect(mocks.webdav.getDirectoryContents).toHaveBeenCalledWith('/remote-root')
    expect(result).toEqual({
      path: '/remote-root',
      parentPath: '/',
      directories: [
        {
          name: 'Cherry',
          path: '/remote-root/Cherry',
          modifiedAt: '2026-05-29T00:00:00.000Z'
        }
      ]
    })
  })

  it('splits pasted WebDAV credentials before creating the setup browser client', async () => {
    await new AppDataSyncService().listRemoteDirectories(
      {
        webdavHost: `http://192.168.1.100:8080/

账号：webdav
密码：test-webdav-password`,
        webdavPath: '/remote-root'
      },
      '/'
    )

    expect(createClient).toHaveBeenLastCalledWith(
      'http://192.168.1.100:8080',
      expect.objectContaining({
        username: 'webdav',
        password: 'test-webdav-password',
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object)
      })
    )
  })

  it('never forwards encoded credential tails as the WebDAV request URL', async () => {
    await new AppDataSyncService().listRemoteDirectories(
      {
        webdavHost:
          'http://192.168.1.100:8080/%0A%0A%E8%B4%A6%E5%8F%B7%EF%BC%9Awebdav%0A%E5%AF%86%E7%A0%81%EF%BC%9Atest-webdav-password',
        webdavUser: 'webdav',
        webdavPass: 'test-webdav-password',
        webdavPath: '/remote-root'
      },
      '/'
    )

    expect(createClient).toHaveBeenLastCalledWith(
      'http://192.168.1.100:8080',
      expect.objectContaining({
        username: 'webdav',
        password: 'test-webdav-password',
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object)
      })
    )
  })

  it('rejects data sync WebDAV access without credentials before sending anonymous requests', async () => {
    await expect(
      new AppDataSyncService().checkWriteAccess({
        webdavHost: 'http://192.168.1.100:8080',
        webdavPath: '/remote-root'
      })
    ).rejects.toThrow('WebDAV 用户名和密码不能为空')

    expect(mocks.webdav.exists).not.toHaveBeenCalled()
  })

  it('checks WebDAV write access against the actual sync path', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000000123)

    try {
      const result = await new AppDataSyncService().checkWriteAccess(config)

      expect(result).toEqual({ ok: true, basePath: '/remote-root/sync/v1' })
      expect(mocks.webdav.exists).toHaveBeenCalledWith('/remote-root/sync/v1')
      expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
        '/remote-root/sync/v1/.cherry-studio-pi-write-test-1760000000123.tmp',
        'ok',
        { overwrite: true }
      )
      expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(
        '/remote-root/sync/v1/.cherry-studio-pi-write-test-1760000000123.tmp'
      )
      for (const probeDir of [
        'storage-v2/bundle',
        'storage-v2/secrets',
        'storage-v2/blobs',
        'notes',
        'runtime-directories/bundles'
      ]) {
        expect(mocks.webdav.exists).toHaveBeenCalledWith(`/remote-root/sync/v1/${probeDir}`)
        expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
          `/remote-root/sync/v1/${probeDir}/.cherry-studio-pi-storage-write-test-1760000000123.tmp`,
          'ok',
          { overwrite: true }
        )
        expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(
          `/remote-root/sync/v1/${probeDir}/.cherry-studio-pi-storage-write-test-1760000000123.tmp`
        )
      }
      expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('rejects WebDAV write access when the sync path cannot delete probe files', async () => {
    mocks.webdav.deleteFile.mockRejectedValueOnce(new Error('delete denied'))

    await expect(new AppDataSyncService().checkWriteAccess(config)).rejects.toThrow(
      'WebDAV request failed while deleting remote sync probe'
    )

    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/remote-root/sync/v1/.cherry-studio-pi-write-test-'),
      'ok',
      { overwrite: true }
    )
  })

  it('rejects WebDAV write access when the client cannot delete remote files', async () => {
    const deleteFile = mocks.webdav.deleteFile
    delete (mocks.webdav as any).deleteFile

    try {
      await expect(new AppDataSyncService().checkWriteAccess(config)).rejects.toThrow(
        '当前 WebDAV 客户端不支持删除远端文件'
      )
    } finally {
      mocks.webdav.deleteFile = deleteFile
    }
  })

  it('does not append the sync suffix twice when users paste the internal sync path', async () => {
    await new AppDataSyncService().syncNow({ ...config, webdavPath: '/remote-root/sync/v1' })

    expect(mocks.webdav.exists).toHaveBeenCalledWith('/remote-root/sync/v1')
    expect(mocks.webdav.exists).not.toHaveBeenCalledWith('/remote-root/sync/v1/sync/v1')
  })

  it('uses a portable remote file lock even when the provider supports native LOCK', async () => {
    await new AppDataSyncService().syncNow(config)

    expect(mocks.webdav.lock).not.toHaveBeenCalled()
    expect(mocks.webdav.setHeaders).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringMatching(/^\/remote-root\/sync\/v1\/\.sync\.locks\/local-device\.[a-f0-9-]+\.json$/),
      expect.stringContaining('"ownerId": "local-device"'),
      { overwrite: false }
    )
    const lockWrite = mocks.webdav.putFileContents.mock.calls.find(
      ([filePath, , options]) => String(filePath).includes('/.sync.locks/') && options?.overwrite === false
    )
    expect(lockWrite).toBeTruthy()
    const lockPayload = JSON.parse(String(lockWrite?.[1]))
    expect(lockPayload).toEqual(
      expect.objectContaining({
        ownerId: 'local-device',
        deadlineAt: expect.any(Number),
        maxRuntimeMs: 10 * 60 * 1000
      })
    )
    expect(lockPayload.expiresAt).toBeLessThanOrEqual(lockPayload.deadlineAt)
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/remote-root\/sync\/v1\/\.sync\.locks\/local-device\.[a-f0-9-]+\.json$/)
    )
  })

  it('holds a power-save blocker for the full WebDAV sync run', async () => {
    await new AppDataSyncService().syncNow(config)

    expect(mocks.powerSaveBlocker.runWithBlocker).toHaveBeenCalledWith(
      'data-sync.webdav',
      expect.any(Function),
      expect.objectContaining({ detail: '/remote-root' })
    )
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors).toHaveBeenCalledTimes(1)
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storageRecordSync.sync.mock.invocationCallOrder[0]
    )
  })

  it('forgets a transient remote lock renewal failure after a later renewal succeeds', async () => {
    vi.useFakeTimers()
    const pendingStorageSync = deferred<{
      manifest: { version: 1; records: Record<string, never>; blobs: Record<string, never> }
      syncStates: never[]
      summary: {
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
    }>()
    mocks.storageRecordSync.sync.mockReturnValueOnce(pendingStorageSync.promise)
    const defaultPutFileContents = mocks.webdav.putFileContents.getMockImplementation()
    let renewalFailuresRemaining = 1

    mocks.webdav.putFileContents.mockImplementation(async (filePath: string, contents: unknown, options?: any) => {
      if (String(filePath).includes('/.sync.locks/') && options?.overwrite === true && renewalFailuresRemaining > 0) {
        renewalFailuresRemaining -= 1
        const error = new Error('temporary lock renewal permission error') as Error & { status?: number }
        error.status = 403
        throw error
      }

      return defaultPutFileContents?.(filePath, contents, options)
    })

    try {
      const service = new AppDataSyncService()
      const sync = service.syncNow(config)

      await vi.waitFor(() => expect(mocks.storageRecordSync.sync).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(30_000)
      expect(renewalFailuresRemaining).toBe(0)

      await vi.advanceTimersByTimeAsync(30_000)

      pendingStorageSync.resolve({
        manifest: { version: 1, records: {}, blobs: {} },
        syncStates: [],
        summary: {
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
      })

      await expect(sync).resolves.toEqual(expect.objectContaining({ status: 'success' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not overlap slow remote lock renewals', async () => {
    vi.useFakeTimers()
    const pendingStorageSync = deferred<{
      manifest: { version: 1; records: Record<string, never>; blobs: Record<string, never> }
      syncStates: never[]
      summary: {
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
    }>()
    const pendingRenewal = deferred<boolean>()
    const defaultPutFileContents = mocks.webdav.putFileContents.getMockImplementation()
    let renewalWrites = 0

    mocks.storageRecordSync.sync.mockReturnValueOnce(pendingStorageSync.promise)
    mocks.webdav.putFileContents.mockImplementation(async (filePath: string, contents: unknown, options?: any) => {
      if (String(filePath).includes('/.sync.locks/') && options?.overwrite === true) {
        renewalWrites += 1
        if (renewalWrites === 1) {
          return pendingRenewal.promise
        }
      }

      return defaultPutFileContents?.(filePath, contents, options)
    })

    try {
      const service = new AppDataSyncService()
      const sync = service.syncNow(config)

      await vi.waitFor(() => expect(mocks.storageRecordSync.sync).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(30_000)
      expect(renewalWrites).toBe(1)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(renewalWrites).toBe(1)

      pendingRenewal.resolve(true)
      await vi.waitFor(() => expect(renewalWrites).toBe(1))

      await vi.advanceTimersByTimeAsync(30_000)
      expect(renewalWrites).toBe(2)

      pendingStorageSync.resolve({
        manifest: { version: 1, records: {}, blobs: {} },
        syncStates: [],
        summary: {
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
      })

      await expect(sync).resolves.toEqual(expect.objectContaining({ status: 'success' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects active remote file locks before mutating records', async () => {
    const now = Date.now()
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/.sync.lock.json',
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'token-b',
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('另一台设备正在同步这个 WebDAV 目录')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.cherry-studio-pi-write-test-/),
      'ok',
      expect.anything()
    )
  })

  it('ignores a legacy remote lock that disappears between exists and read', async () => {
    const now = Date.now()
    const lockPath = '/remote-root/sync/v1/.sync.lock.json'
    mocks.remoteFiles.set(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'released-token',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10 * 60 * 1000,
        leaseMs: 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )
    mocks.webdav.getFileContents.mockImplementationOnce(async (filePath: string) => {
      expect(filePath).toBe(lockPath)
      mocks.remoteFiles.delete(lockPath)
      const error = new Error('Invalid response: 404 Not Found') as Error & { status: number }
      error.status = 404
      throw error
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
    expect(mocks.remoteFiles.has(lockPath)).toBe(false)
  })

  it('rejects oversized remote lock files before downloading their contents', async () => {
    const lockPath = '/remote-root/sync/v1/.sync.lock.json'
    mocks.remoteFiles.set(lockPath, Buffer.alloc(65 * 1024))

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步锁读取失败')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(lockPath, { format: 'binary' })
    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
  })

  it('rejects active remote lock claims from another device before mutating records', async () => {
    mockDirectoryContentsFromRemoteFiles()
    const now = Date.now()
    const lockPath = '/remote-root/sync/v1/.sync.locks/device-b.token-b.json'
    mocks.remoteFiles.set(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'token-b',
        runtimeId: 'device-b-runtime',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 2 * 60 * 1000,
        leaseMs: 2 * 60 * 1000,
        deadlineAt: now + 10 * 60 * 1000,
        maxRuntimeMs: 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('另一台设备正在同步这个 WebDAV 目录')

    expect(mocks.webdav.deleteFile).not.toHaveBeenCalledWith(lockPath)
    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.cherry-studio-pi-write-test-/),
      'ok',
      expect.anything()
    )
  })

  it('reclaims unreadable remote lock claims instead of blocking sync forever', async () => {
    mockDirectoryContentsFromRemoteFiles()
    const lockPath = '/remote-root/sync/v1/.sync.locks/device-b.partial-token.json'
    mocks.remoteFiles.set(lockPath, '{ partially-written-lock')

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(lockPath)
    expect(mocks.remoteFiles.has(lockPath)).toBe(false)
    expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
  })

  it('rejects oversized remote lock claim directories before reading every lock file', async () => {
    mockDirectoryContentsFromRemoteFiles()
    for (let index = 0; index < 257; index += 1) {
      mocks.remoteFiles.set(
        `/remote-root/sync/v1/.sync.locks/device-${index}.token-${index}.json`,
        JSON.stringify({
          version: 1,
          ownerId: `device-${index}`,
          token: `token-${index}`,
          runtimeId: `runtime-${index}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 2 * 60 * 1000,
          leaseMs: 2 * 60 * 1000,
          app: 'cherry-studio-pi',
          reason: 'data-sync'
        })
      )
    }

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步锁目录异常')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
  })

  it('reclaims a previous lock left by the same device before syncing', async () => {
    const now = Date.now()
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/.sync.lock.json',
      JSON.stringify({
        version: 1,
        ownerId: 'local-device',
        token: 'previous-token',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10 * 60 * 1000,
        leaseMs: 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.sync.lock.json')
    expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
  })

  it('keeps a fresh same-device runtime lock blocking instead of deleting it', async () => {
    mockDirectoryContentsFromRemoteFiles()
    const service = new AppDataSyncService()
    const now = Date.now()
    const lockPath = '/remote-root/sync/v1/.sync.locks/local-device.active-token.json'
    mocks.remoteFiles.set(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'local-device',
        token: 'active-token',
        runtimeId: (service as any).runtimeId,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 2 * 60 * 1000,
        leaseMs: 2 * 60 * 1000,
        deadlineAt: now + 10 * 60 * 1000,
        maxRuntimeMs: 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    await expect(service.syncNow(config)).rejects.toThrow('当前设备已有一次同步正在占用这个 WebDAV 目录')

    expect(mocks.webdav.deleteFile).not.toHaveBeenCalledWith(lockPath)
    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
  })

  it('reclaims stale remote file locks whose heartbeat stopped even if their old expiry is far away', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000000000)
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/.sync.lock.json',
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'stale-token',
        createdAt: 1760000000000 - 10 * 60 * 1000,
        expiresAt: 1760000000000 + 30 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.status).toBe('success')
      expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.sync.lock.json')
      expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reclaims old remote file locks even when an older app version keeps refreshing their heartbeat', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000000000)
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/.sync.lock.json',
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'long-running-token',
        createdAt: 1760000000000 - 11 * 60 * 1000,
        updatedAt: 1760000000000,
        expiresAt: 1760000000000 + 2 * 60 * 1000,
        leaseMs: 2 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.status).toBe('success')
      expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.sync.lock.json')
      expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('unlocks stale server-side WebDAV locks before creating the portable lock directory', async () => {
    let lockDirectoryCreateAttempts = 0
    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      const remotePath = String(filePath)
      if (remotePath.endsWith('/.sync.lock.json')) return false
      if (remotePath === '/remote-root/sync/v1/.sync.locks') return false
      if (remotePath.includes('/.sync.locks/')) return mocks.remoteFiles.has(remotePath)
      if (mocks.remoteFiles.has(remotePath)) return true
      return true
    })
    mocks.webdav.createDirectory.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/remote-root/sync/v1/.sync.locks' && lockDirectoryCreateAttempts === 0) {
        lockDirectoryCreateAttempts += 1
        throw new Error('Invalid response: 423 Locked')
      }
      lockDirectoryCreateAttempts += dirPath === '/remote-root/sync/v1/.sync.locks' ? 1 : 0
    })
    mocks.webdav.customRequest.mockImplementation(async (remotePath: string) => ({
      text: async () =>
        remotePath === '/remote-root/sync/v1'
          ? '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:lockdiscovery><d:activelock><d:locktoken><d:href>opaquelocktoken:server-stale</d:href></d:locktoken></d:activelock></d:lockdiscovery></d:prop></d:propstat></d:response></d:multistatus>'
          : '<d:multistatus xmlns:d="DAV:" />'
    }))

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.customRequest).toHaveBeenCalledWith(
      '/remote-root/sync/v1',
      expect.objectContaining({ method: 'PROPFIND' })
    )
    expect(mocks.webdav.unlock).toHaveBeenCalledWith('/remote-root/sync/v1', 'opaquelocktoken:server-stale')
    expect(mocks.storageRecordSync.sync).toHaveBeenCalled()
  })

  it('reports active remote locks during WebDAV diagnosis instead of passing readiness checks', async () => {
    const now = Date.now()
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/.sync.lock.json',
      JSON.stringify({
        version: 1,
        ownerId: 'device-b',
        token: 'token-b',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10 * 60 * 1000,
        leaseMs: 10 * 60 * 1000,
        app: 'cherry-studio-pi',
        reason: 'data-sync'
      })
    )

    await expect(new AppDataSyncService().checkWriteAccess(config)).rejects.toThrow(
      '另一台设备正在同步这个 WebDAV 目录'
    )

    expect(mocks.webdav.putFileContents).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.cherry-studio-pi-write-test-/),
      'ok',
      expect.anything()
    )
  })

  it('stops before publishing the manifest when a fallback file lock is stolen mid-sync', async () => {
    const uploadedAt = Date.now()
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          generation: 2,
          updatedAt: uploadedAt,
          records: {},
          snapshots: {
            'local-device': {
              id: 'local-device',
              fileName: 'cherry-studio-pi.data-sync.local-device.zip',
              path: 'backups/cherry-studio-pi.data-sync.local-device.zip',
              byteSize: 6,
              createdAt: new Date(uploadedAt).toISOString(),
              uploadedAt,
              deviceId: 'local-device',
              format: 'cherry-studio-direct-backup-zip'
            }
          }
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockImplementationOnce(async () => {
      const lockPath = [...mocks.remoteFiles.keys()].map(String).find((filePath) => filePath.includes('/.sync.locks/'))
      expect(lockPath).toBeTruthy()
      mocks.remoteFiles.set(
        lockPath!,
        JSON.stringify({
          version: 1,
          ownerId: 'device-b',
          token: 'stolen-token',
          createdAt: uploadedAt,
          expiresAt: uploadedAt + 10 * 60 * 1000,
          app: 'cherry-studio-pi',
          reason: 'data-sync'
        })
      )

      return {
        manifest: { version: 1, records: {}, blobs: {} },
        syncStates: [],
        summary: {
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
      }
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步锁在同步过程中已被其他设备修改')

    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith('last-sync-summary', expect.anything())
  })

  it('tries to create the sync directory when WebDAV denies directory existence checks', async () => {
    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      if (filePath === '/remote-root/sync/v1') {
        throw new Error('Invalid response: 403 Forbidden')
      }
      if (String(filePath).includes('/.sync.lock') || String(filePath).includes('/.sync.locks')) {
        return mocks.remoteFiles.has(filePath)
      }

      return true
    })

    await new AppDataSyncService().syncNow(config)

    expect(mocks.webdav.createDirectory).toHaveBeenCalledWith('/remote-root/sync/v1', { recursive: true })
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringMatching(/^\/remote-root\/sync\/v1\/\.cherry-studio-pi-write-test-/),
      'ok',
      { overwrite: true }
    )
  })

  it('restores the newest remote safety snapshot even when it belongs to this device', async () => {
    const oldSnapshot = {
      id: 'remote-old',
      fileName: 'old-device.zip',
      path: 'backups/old-device.zip',
      byteSize: 3,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    const latestSnapshot = {
      id: 'local-new',
      fileName: 'local-device.zip',
      path: 'backups/local-device.zip',
      byteSize: 6,
      createdAt: new Date(1760000001000).toISOString(),
      uploadedAt: 1760000001000,
      deviceId: 'local-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      new Uint8Array(
        Buffer.from(
          JSON.stringify({
            version: 1,
            generation: 2,
            updatedAt: 1760000001000,
            records: {},
            latestSnapshot: oldSnapshot,
            snapshots: {
              [oldSnapshot.id]: oldSnapshot,
              [latestSnapshot.id]: latestSnapshot
            }
          })
        )
      )
    )
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/old-device.zip', Buffer.from('old'))
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/local-device.zip', new Uint8Array(Buffer.from('latest')))

    await new AppDataSyncService().restoreLatestSnapshot(config)

    expect(mocks.powerSaveBlocker.runWithBlocker).toHaveBeenCalledWith(
      'data-sync.snapshot-restore',
      expect.any(Function),
      expect.objectContaining({ detail: '/remote-root' })
    )
    expect(mocks.webdav.getFileContents).toHaveBeenCalledWith('/remote-root/sync/v1/backups/local-device.zip', {
      format: 'binary'
    })
    expect(mocks.backupManager.restore).toHaveBeenCalledWith(
      undefined,
      expect.stringContaining('local-new.local-device.zip')
    )
  })

  it('prefers a newer latestSnapshot fallback even when snapshots is stale', async () => {
    const listedSnapshot = {
      id: 'listed-old',
      fileName: 'listed-old.zip',
      path: 'backups/listed-old.zip',
      byteSize: 3,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    const latestSnapshot = {
      id: 'latest-only',
      fileName: 'latest-only.zip',
      path: 'backups/latest-only.zip',
      byteSize: 6,
      createdAt: new Date(1760000002000).toISOString(),
      uploadedAt: 1760000002000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000002000,
        records: {},
        latestSnapshot,
        snapshots: {
          [listedSnapshot.id]: listedSnapshot
        }
      })
    )
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/listed-old.zip', Buffer.from('old'))
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/latest-only.zip', Buffer.from('latest'))

    await new AppDataSyncService().restoreLatestSnapshot(config)

    expect(mocks.webdav.getFileContents).toHaveBeenCalledWith('/remote-root/sync/v1/backups/latest-only.zip', {
      format: 'binary'
    })
    expect(mocks.backupManager.restore).toHaveBeenCalledWith(
      undefined,
      expect.stringContaining('latest-only.latest-only.zip')
    )
  })

  it('sanitizes remote safety snapshot file names before restoring', async () => {
    const snapshot = {
      id: 'remote snapshot',
      fileName: '../../bad:name?.zip',
      path: 'backups/remote-device.zip',
      byteSize: 6,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000000000,
        records: {},
        snapshots: {
          [snapshot.id]: snapshot
        }
      })
    )
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/remote-device.zip', Buffer.from('latest'))

    await new AppDataSyncService().restoreLatestSnapshot(config)

    expect(path.basename(mocks.backupManager.restore.mock.calls[0]?.[1] as string)).toBe(
      'remote-snapshot.bad-name-.zip'
    )
  })

  it('uses TEMP as the restore temp root when TMPDIR is unavailable', async () => {
    const previousTmpdir = process.env.TMPDIR
    const previousTemp = process.env.TEMP
    const previousTmp = process.env.TMP
    const tempRoot = path.join('/tmp', `cherry-studio-pi-restore-temp-${Date.now()}`)
    const snapshot = {
      id: 'remote-temp',
      fileName: 'remote-temp.zip',
      path: 'backups/remote-temp.zip',
      byteSize: 6,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000000000,
        records: {},
        snapshots: {
          [snapshot.id]: snapshot
        }
      })
    )
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/remote-temp.zip', Buffer.from('latest'))

    try {
      delete process.env.TMPDIR
      process.env.TEMP = tempRoot
      delete process.env.TMP

      await new AppDataSyncService().restoreLatestSnapshot(config)

      expect(path.dirname(mocks.backupManager.restore.mock.calls[0]?.[1] as string)).toBe(
        path.join(tempRoot, 'cherry-studio-pi-data-sync')
      )
    } finally {
      if (previousTmpdir === undefined) {
        delete process.env.TMPDIR
      } else {
        process.env.TMPDIR = previousTmpdir
      }
      if (previousTemp === undefined) {
        delete process.env.TEMP
      } else {
        process.env.TEMP = previousTemp
      }
      if (previousTmp === undefined) {
        delete process.env.TMP
      } else {
        process.env.TMP = previousTmp
      }
      await fsp.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects oversized remote safety snapshots before downloading them', async () => {
    const oversizedSnapshot = {
      id: 'remote-big',
      fileName: 'big-device.zip',
      path: 'backups/big-device.zip',
      byteSize: 2 * 1024 * 1024 * 1024 + 1,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000000000,
        records: {},
        snapshots: {
          [oversizedSnapshot.id]: oversizedSnapshot
        }
      })
    )

    await expect(new AppDataSyncService().restoreLatestSnapshot(config)).rejects.toThrow('远端安全快照过大')

    expect(
      mocks.webdav.getFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/backups/big-device.zip'))
    ).toBe(false)
    expect(mocks.backupManager.restore).not.toHaveBeenCalled()
  })

  it('checks the remote safety snapshot size before restoring it', async () => {
    const snapshot = {
      id: 'remote-stat-big',
      fileName: 'stat-big-device.zip',
      path: 'backups/stat-big-device.zip',
      byteSize: 6,
      createdAt: new Date(1760000000000).toISOString(),
      uploadedAt: 1760000000000,
      deviceId: 'remote-device',
      format: 'cherry-studio-direct-backup-zip'
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000000000,
        records: {},
        snapshots: {
          [snapshot.id]: snapshot
        }
      })
    )
    const defaultStat = mocks.webdav.stat.getMockImplementation()
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('/backups/stat-big-device.zip')) {
        return { size: 2 * 1024 * 1024 * 1024 + 1 }
      }
      return defaultStat?.(filePath)
    })

    await expect(new AppDataSyncService().restoreLatestSnapshot(config)).rejects.toThrow('远端安全快照过大')

    expect(
      mocks.webdav.getFileContents.mock.calls.some(([filePath]) =>
        String(filePath).endsWith('/backups/stat-big-device.zip')
      )
    ).toBe(false)
    expect(mocks.backupManager.restore).not.toHaveBeenCalled()
  })

  it('applies downloaded remote app records to Storage v2 before legacy app.db', async () => {
    const events: string[] = []
    mocks.storageV2.upsertRecordSnapshot.mockImplementation(async () => {
      events.push('storage-v2')
    })
    mocks.db.applyRemoteRecord.mockImplementation(async () => {
      events.push('legacy')
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary).toEqual(
      expect.objectContaining({
        status: 'success',
        remoteGeneration: 1,
        remoteManifestHash: expect.any(String)
      })
    )
    expect(summary.downloaded).toBe(1)
    expect(events).toEqual(['storage-v2', 'legacy'])
    expect(mocks.storageV2.upsertRecordSnapshot).toHaveBeenCalledWith(remoteRecord)
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
  })

  it('stops before publishing the final manifest when another device changes remote state mid-sync', async () => {
    const uploadedAt = Date.now()
    const baselineManifest = {
      version: 1,
      generation: 4,
      updatedAt: uploadedAt,
      records: {},
      storageV2: null,
      snapshots: {
        'local-device': {
          id: 'local-device',
          fileName: 'cherry-studio-pi.data-sync.local-device.zip',
          path: 'backups/cherry-studio-pi.data-sync.local-device.zip',
          byteSize: 6,
          createdAt: new Date(uploadedAt).toISOString(),
          uploadedAt,
          deviceId: 'local-device',
          format: 'cherry-studio-direct-backup-zip'
        }
      }
    }
    let manifestReadCount = 0
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        manifestReadCount += 1
        return JSON.stringify(
          manifestReadCount === 1 ? baselineManifest : { ...baselineManifest, generation: 5, updatedAt: uploadedAt + 1 }
        )
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步状态在同步过程中已被其他设备修改')

    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith('last-sync-summary', expect.anything())
  })

  it('does not write downloaded remote records to legacy app.db when Storage v2 rejects them', async () => {
    mocks.storageV2.upsertRecordSnapshot.mockRejectedValueOnce(new Error('storage-v2 failed'))

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('storage-v2 failed')
    expect(mocks.db.applyRemoteRecord).not.toHaveBeenCalled()
  })

  it('writes sync state to Storage v2 before legacy app.db state', async () => {
    const events: string[] = []
    mocks.storageV2.upsertSyncState.mockImplementation(async () => {
      events.push('storage-v2-sync-state')
    })
    mocks.db.setSyncState.mockImplementation(async () => {
      events.push('legacy-sync-state')
    })

    await new AppDataSyncService().syncNow(config)

    expect(events.slice(0, 2)).toEqual(['storage-v2-sync-state', 'legacy-sync-state'])
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash')
    expect(mocks.db.setSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash', {
      storageV2Mirrored: true
    })
  })

  it('prefers remote app records and keeps a recovery audit when a device has no prior sync baseline', async () => {
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'new-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.downloaded).toBe(1)
    expect(summary.conflicts).toBe(0)
    expect(summary.resolvedConflicts).toBe(1)
    expect(summary.joinSafetySnapshotCreated).toBe(false)
    expect(summary.joinSafetySnapshotFileName).toBeNull()
    expect(summary.joinSafetySnapshotBytes).toBe(0)
    expect(mocks.storageV2.upsertRecordSnapshot).toHaveBeenCalledWith(remoteRecord)
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
    expect(mocks.storageV2.upsertSyncConflict).toHaveBeenCalled()
    expect(mocks.db.createConflict).toHaveBeenCalled()
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash')
    expect(mocks.backupManager.backup).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents.mock.calls.some((call) => String(call[1]).includes('local-default-hash'))).toBe(
      false
    )
  })

  it('prunes stale local data sync temp backups without creating a join safety snapshot by default', async () => {
    const tempBackupDir = path.join(
      process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp',
      'cherry-studio-pi',
      'backup'
    )
    const legacyTempBackupDir = path.join(
      process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp',
      'cherry-studio',
      'backup'
    )
    await fsp.mkdir(tempBackupDir, { recursive: true })
    await fsp.mkdir(legacyTempBackupDir, { recursive: true })
    const staleJoinSafetyPath = path.join(tempBackupDir, 'cherry-studio-pi.data-sync.join-safety.local-device.1.zip')
    const staleFullSnapshotPath = path.join(legacyTempBackupDir, 'cherry-studio-pi.data-sync.local-device.1.zip')
    await fsp.writeFile(staleJoinSafetyPath, 'stale-join-safety')
    await fsp.writeFile(staleFullSnapshotPath, 'stale-full-snapshot')

    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'new-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.joinSafetySnapshotCreated).toBe(false)
    expect(summary.joinSafetySnapshotPath).toBeNull()
    expect(await pathExists(staleJoinSafetyPath)).toBe(false)
    expect(await pathExists(staleFullSnapshotPath)).toBe(false)
    expect(mocks.backupManager.backup).not.toHaveBeenCalled()
  })

  it('creates a local join safety snapshot only when explicitly enabled', async () => {
    process.env.CHERRY_STUDIO_DATA_SYNC_LOCAL_SAFETY_SNAPSHOT = '1'
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'new-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.joinSafetySnapshotCreated).toBe(true)
    expect(summary.joinSafetySnapshotFileName).toMatch(
      /^cherry-studio-pi\.data-sync\.join-safety\.local-device\.\d+\.zip$/
    )
    expect(summary.joinSafetySnapshotBytes).toBe(6)
    expect(mocks.backupManager.backup).toHaveBeenCalledWith(
      undefined,
      summary.joinSafetySnapshotFileName,
      undefined,
      false
    )
  })

  it('hydrates remote app records without per-record conflict audits when joining an existing sync space', async () => {
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'new-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          ...remoteManifest,
          generation: 12,
          syncSpace: {
            version: 1,
            id: 'sync-space-existing',
            createdAt: 1760000000000,
            keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
            keyFormat: 'cherry-sync-space-key-v1',
            secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          }
        })
      }

      if (filePath.endsWith('/records/settings/theme.json')) {
        return JSON.stringify(remoteRecord)
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.downloaded).toBe(1)
    expect(summary.conflicts).toBe(0)
    expect(summary.resolvedConflicts).toBe(0)
    expect(summary.joinSafetySnapshotCreated).toBe(false)
    expect(mocks.storageV2.upsertRecordSnapshot).toHaveBeenCalledWith(remoteRecord)
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
    expect(mocks.storageV2.upsertSyncConflict).not.toHaveBeenCalled()
    expect(mocks.db.createConflict).not.toHaveBeenCalled()
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash')
    expect(mocks.webdav.putFileContents.mock.calls.some((call) => String(call[1]).includes('local-default-hash'))).toBe(
      false
    )
  })

  it('does not create full local safety snapshots for failure summaries by default', async () => {
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'new-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)
    mocks.storageRecordSync.pruneRemoteArtifacts.mockRejectedValueOnce(new Error('cleanup denied'))

    const service = new AppDataSyncService()
    await expect(service.syncNow(config)).rejects.toThrow('远端旧同步文件清理失败')

    const failureSummary = await service.recordSyncFailure(new Error('cleanup denied'))

    expect(failureSummary).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'cleanup denied',
        joinSafetySnapshotCreated: false,
        joinSafetySnapshotFileName: null,
        joinSafetySnapshotPath: null,
        joinSafetySnapshotBytes: 0
      })
    )
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'last-sync-summary',
      expect.objectContaining({
        status: 'failed',
        joinSafetySnapshotCreated: false,
        joinSafetySnapshotBytes: 0
      })
    )
    expect(mocks.backupManager.backup).not.toHaveBeenCalled()
  })

  it('auto-resolves exact legacy app record conflicts with a deterministic content tie-breaker and audit', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000000999)
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'light' },
      valueHash: 'local-hash',
      updatedAt: remoteRecord.updatedAt,
      deviceId: 'local-device'
    }
    const events: string[] = []
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === 'record:settings:theme:hash' ? 'base-hash' : null
    )
    mocks.storageV2.upsertSyncConflict.mockImplementation(async () => {
      events.push('storage-v2-conflict')
    })
    mocks.db.createConflict.mockImplementation(async () => {
      events.push('legacy-conflict')
      return 'settings:theme:stable-conflict-id'
    })

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.conflicts).toBe(0)
      expect(summary.resolvedConflicts).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }

    expect(events).toEqual(['storage-v2-conflict', 'legacy-conflict'])
    expect(mocks.storageV2.upsertSyncConflict).toHaveBeenCalledWith(
      expect.stringMatching(/^settings:theme:/),
      expect.objectContaining({
        baseHash: 'base-hash',
        localRecord,
        remoteRecord,
        resolvedAt: 1760000000999
      })
    )
    expect(mocks.db.createConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^settings:theme:/),
        baseHash: 'base-hash',
        localRecord,
        remoteRecord,
        resolvedAt: 1760000000999
      }),
      { storageV2Mirrored: true }
    )
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
  })

  it('counts auto-resolved app record conflicts and stores resolved conflict records', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000001777)
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'light' },
      valueHash: 'local-hash',
      updatedAt: remoteRecord.updatedAt + 1,
      deviceId: 'local-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === 'record:settings:theme:hash' ? 'base-hash' : null
    )

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.conflicts).toBe(0)
      expect(summary.resolvedConflicts).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }

    expect(mocks.storageV2.upsertSyncConflict).toHaveBeenCalledWith(
      expect.stringMatching(/^settings:theme:/),
      expect.objectContaining({
        baseHash: 'base-hash',
        localRecord,
        remoteRecord,
        resolvedAt: 1760000001777
      })
    )
    expect(mocks.db.createConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^settings:theme:/),
        baseHash: 'base-hash',
        localRecord,
        remoteRecord,
        resolvedAt: 1760000001777
      }),
      { storageV2Mirrored: true }
    )
  })

  it('falls back to Storage v2 sync state when legacy app.db is missing the last hash', async () => {
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'light' },
      valueHash: 'local-hash',
      updatedAt: 1760000000001,
      deviceId: 'local-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockResolvedValue(null)
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) =>
      id === 'record:settings:theme:hash' ? 'local-hash' : null
    )

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.downloaded).toBe(1)
    expect(summary.conflicts).toBe(0)
    expect(mocks.storageV2.getSyncState).toHaveBeenCalledWith('record:settings:theme:hash')
    expect(mocks.storageV2.upsertRecordSnapshot).toHaveBeenCalledWith(remoteRecord)
    expect(mocks.db.createConflict).not.toHaveBeenCalled()
  })

  it('skips legacy app-data record files when Storage v2 app records cover app data', async () => {
    const localRecord = {
      ...remoteRecord,
      valueHash: 'local-hash',
      updatedAt: 1760000000001,
      deviceId: 'storage-v2-device'
    }
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.db.listRecords.mockResolvedValue([])
    mocks.recovery.projectIfLegacyAppRecordListEmpty.mockResolvedValueOnce(false)
    mocks.storageV2.listRecords.mockResolvedValueOnce([localRecord])

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.uploaded).toBe(0)
    expect(mocks.storageV2.listRecords).toHaveBeenCalledWith(undefined, true)
    expect([...mocks.remoteFiles.keys()].some((filePath) => String(filePath).includes('/records/'))).toBe(false)
    expect(JSON.parse(String(mocks.remoteFiles.get('/remote-root/sync/v1/manifest.json'))).records).toEqual({})
  })

  it('does not project runtime caches for a first-time Storage v2 upload to an empty remote', async () => {
    const uploadedStorageManifest = {
      version: 1,
      records: {
        'agent:agent-1': {
          entityType: 'agent',
          table: 'agents',
          idValues: ['agent-1'],
          valueHash: 'agent-hash',
          updatedAt: 1760000000000,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/agent/agent-1.json'
        }
      },
      blobs: {}
    }
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: uploadedStorageManifest,
      syncStates: [],
      summary: {
        storageUploaded: 1,
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
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.storageUploaded).toBe(1)
    expect(mocks.runtimeProjection.projectAgents).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectFiles).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectAppData).not.toHaveBeenCalled()
  })

  it('rejects oversized remote manifests before downloading them', async () => {
    const manifestPath = '/remote-root/sync/v1/manifest.json'
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      if (filePath === manifestPath) return { size: 17 * 1024 * 1024 }
      const value = mocks.remoteFiles.get(filePath)
      if (Buffer.isBuffer(value)) return { size: value.byteLength }
      if (typeof value === 'string') return { size: Buffer.byteLength(value, 'utf8') }
      return { size: 0 }
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步状态 manifest.json过大')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(manifestPath, { format: 'binary' })
    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
  })

  it('rejects malformed remote app-data record manifests before publishing', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: []
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端应用数据 records manifest 格式损坏')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects remote app-data record manifests with root-relative artifact paths before publishing', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {
          'settings:theme': {
            scope: 'settings',
            key: 'theme',
            valueHash: 'hash',
            updatedAt: 1760000000000,
            deviceId: 'remote-device',
            version: 1,
            path: '.'
          }
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('Remote app data record path is invalid')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects remote app-data record manifests with Windows-style artifact paths before publishing', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {
          'settings:theme': {
            scope: 'settings',
            key: 'theme',
            valueHash: 'hash',
            updatedAt: 1760000000000,
            deviceId: 'remote-device',
            version: 1,
            path: 'records\\settings\\theme.json'
          }
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('Remote app data record path is invalid')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects malformed top-level Storage v2 manifests before publishing', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        storageV2: 'corrupted'
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端 Storage v2 manifest 格式损坏')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects malformed remote notes manifests before treating them as empty', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        notes: {
          version: 1,
          updatedAt: 1760000000000,
          files: []
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端笔记文件 manifest 格式损坏')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects remote notes paths that are absolute before downloading contents', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        notes: {
          version: 1,
          updatedAt: 1760000000000,
          files: {
            '/outside.md': {
              version: 1,
              relativePath: '/outside.md',
              valueHash: 'a'.repeat(64),
              byteSize: 4,
              updatedAt: 1760000000000,
              deletedAt: null,
              deviceId: 'remote-device',
              path: 'notes/files/outside.bin'
            }
          }
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('Remote notes file path is invalid')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.getFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/notes/files/'))
    ).toBe(false)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects runtime directory empty-state manifests with a mismatched content hash', async () => {
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        runtimeDirectories: {
          version: 1,
          updatedAt: 1760000000000,
          directories: {
            Skills: {
              version: 1,
              name: 'Skills',
              valueHash: 'a'.repeat(64),
              byteSize: 0,
              compressedByteSize: 128,
              fileCount: 0,
              updatedAt: 1760000000000,
              deviceId: 'remote-device',
              path: `runtime-directories/bundles/Skills/${'a'.repeat(64)}.json.gz`
            }
          }
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端运行时目录空状态校验信息损坏：Skills')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects runtime directory manifests with invalid size fields before publishing', async () => {
    const emptyRuntimeHash = hashJson([])
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        runtimeDirectories: {
          version: 1,
          updatedAt: 1760000000000,
          directories: {
            Skills: {
              version: 1,
              name: 'Skills',
              valueHash: emptyRuntimeHash,
              byteSize: 0,
              compressedByteSize: 'many',
              fileCount: 0,
              updatedAt: 1760000000000,
              deviceId: 'remote-device',
              path: `runtime-directories/bundles/Skills/${emptyRuntimeHash}.json.gz`
            }
          }
        }
      })
    )

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端运行时目录 Skills 压缩大小字段损坏')

    expect(mocks.storageRecordSync.sync).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
  })

  it('rejects oversized remote notes files before downloading their contents', async () => {
    const notePath = '/remote-root/sync/v1/notes/files/big-note.bin'
    mocks.remoteFiles.set(notePath, Buffer.from('oversized placeholder'))
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      if (filePath === notePath) return { size: 65 * 1024 * 1024 }
      const value = mocks.remoteFiles.get(filePath)
      if (Buffer.isBuffer(value)) return { size: value.byteLength }
      if (typeof value === 'string') return { size: Buffer.byteLength(value, 'utf8') }
      return { size: 0 }
    })
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: 1760000000000,
          records: {},
          notes: {
            version: 1,
            updatedAt: 1760000000000,
            files: {
              'big.md': {
                version: 1,
                relativePath: 'big.md',
                valueHash: 'a'.repeat(64),
                byteSize: 1,
                updatedAt: 1760000000000,
                deletedAt: null,
                deviceId: 'device-b',
                path: 'notes/files/big-note.bin'
              }
            }
          }
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端笔记文件 big.md过大')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(notePath, { format: 'binary' })
  })

  it('rejects oversized local notes files before uploading them', async () => {
    const localNotePath = path.join(mocks.notesDir, 'big.md')
    await fsp.mkdir(path.dirname(localNotePath), { recursive: true })
    await fsp.writeFile(localNotePath, '')
    await fsp.truncate(localNotePath, 65 * 1024 * 1024)

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('本地笔记文件过大')

    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/notes/files/'))
    ).toBe(false)
  })

  it('syncs notes from the configured notes directory instead of only the default directory', async () => {
    mocks.preferenceService.get.mockImplementation((key: string) =>
      key === 'feature.notes.path' ? mocks.configuredNotesDir : ''
    )
    const configuredNotePath = path.join(mocks.configuredNotesDir, 'configured.md')
    const defaultNotePath = path.join(mocks.notesDir, 'default.md')
    await fsp.mkdir(path.dirname(configuredNotePath), { recursive: true })
    await fsp.mkdir(path.dirname(defaultNotePath), { recursive: true })
    await fsp.writeFile(configuredNotePath, '# Configured Notes Root')
    await fsp.writeFile(defaultNotePath, '# Default Notes Root')

    const summary = await new AppDataSyncService().syncNow(config)
    const publishedManifest = JSON.parse(String(mocks.remoteFiles.get('/remote-root/sync/v1/manifest.json')))

    expect(summary.uploaded).toBe(1)
    expect(publishedManifest.notes.files['configured.md']).toMatchObject({
      relativePath: 'configured.md',
      deletedAt: null
    })
    expect(publishedManifest.notes.files['default.md']).toBeUndefined()
  })

  it('rejects oversized remote runtime directory manifests before downloading bundles', async () => {
    const oversizedHash = 'a'.repeat(64)
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: 1760000000000,
          records: {},
          runtimeDirectories: {
            version: 1,
            updatedAt: 1760000000000,
            directories: {
              Skills: {
                version: 1,
                name: 'Skills',
                valueHash: oversizedHash,
                byteSize: 32 * 1024 * 1024 + 1,
                compressedByteSize: 1024,
                fileCount: 1,
                updatedAt: 1760000000000,
                deviceId: 'device-b',
                path: `runtime-directories/bundles/Skills/${oversizedHash}.json.gz`
              }
            }
          }
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端 Skills 目录过大')

    expect(
      mocks.webdav.getFileContents.mock.calls.some(([filePath]) =>
        String(filePath).includes('/runtime-directories/bundles/Skills/')
      )
    ).toBe(false)
    expect(mocks.runtimeProjection.projectAgents).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectFiles).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectAppData).not.toHaveBeenCalled()
  })

  it('rejects remote runtime directory bundles that expand beyond the JSON budget', async () => {
    const bundleHash = 'b'.repeat(64)
    const remoteBundlePath = `/remote-root/sync/v1/runtime-directories/bundles/Skills/${bundleHash}.json.gz`
    const compressedBomb = gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x20), { level: 9 })
    mocks.remoteFiles.set(remoteBundlePath, compressedBomb)
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: 1760000000000,
          records: {},
          runtimeDirectories: {
            version: 1,
            updatedAt: 1760000000000,
            directories: {
              Skills: {
                version: 1,
                name: 'Skills',
                valueHash: bundleHash,
                byteSize: 1,
                compressedByteSize: compressedBomb.byteLength,
                fileCount: 1,
                updatedAt: 1760000000000,
                deviceId: 'device-b',
                path: `runtime-directories/bundles/Skills/${bundleHash}.json.gz`
              }
            }
          }
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端 Skills 目录数据包无法解压或解析')

    expect(mocks.webdav.getFileContents).toHaveBeenCalledWith(remoteBundlePath, { format: 'binary' })
    expect(mocks.runtimeProjection.projectAgents).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectFiles).not.toHaveBeenCalled()
    expect(mocks.runtimeProjection.projectAppData).not.toHaveBeenCalled()
  })

  it('fails before publishing the manifest when an existing runtime directory bundle cannot be verified', async () => {
    const skillPath = path.join(mocks.runtimeDataRoot, 'Skills', 'sync-fixture', 'SKILL.md')
    await fsp.mkdir(path.dirname(skillPath), { recursive: true })
    await fsp.writeFile(skillPath, '# Broken Remote Bundle Guard')
    const mtime = new Date('2026-06-01T12:00:00.000Z')
    await fsp.utimes(skillPath, mtime, mtime)

    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      if (String(filePath).endsWith('/.sync.lock.json')) {
        return mocks.remoteFiles.has(filePath)
      }
      if (String(filePath).includes('/runtime-directories/bundles/Skills/')) {
        mocks.remoteFiles.set(filePath, Buffer.from('not a valid runtime bundle'))
        return true
      }
      if (mocks.remoteFiles.has(filePath)) return true
      return true
    })

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端 Skills 目录数据包')

    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith('last-sync-summary', expect.anything())
  })

  it('defers local-only app data records when first joining an existing sync space', async () => {
    mocks.db.listRecords.mockResolvedValueOnce([
      {
        scope: 'settings',
        key: 'local-only',
        value: { mode: 'default' },
        valueHash: 'local-only-hash',
        updatedAt: 1760100000000,
        deletedAt: null,
        deviceId: 'local-device',
        version: 1
      }
    ])
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 2,
        updatedAt: 1760000000000,
        records: remoteManifest.records,
        syncSpace: {
          version: 1,
          id: 'sync-space-existing',
          createdAt: 1760000000000,
          keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
          keyFormat: 'cherry-sync-space-key-v1',
          secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
        }
      })
    )

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.downloaded).toBe(1)
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) =>
        String(filePath).includes('/records/settings/local-only/')
      )
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'record:settings:local-only:hash',
      'deferred-local:local-only-hash'
    )
  })

  it('downloads remote app data records that appear after a local first-join defer', async () => {
    const localRecord = {
      ...remoteRecord,
      value: { mode: 'local-default' },
      valueHash: 'local-default-hash',
      updatedAt: remoteRecord.updatedAt + 60_000,
      deviceId: 'local-device'
    }
    mocks.db.listRecords.mockResolvedValue([localRecord])
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === 'record:settings:theme:hash' ? 'deferred-local:local-default-hash' : null
    )

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.downloaded).toBe(1)
    expect(summary.uploaded).toBe(0)
    expect(summary.resolvedConflicts).toBe(0)
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
    expect(mocks.db.createConflict).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents.mock.calls.some((call) => String(call[1]).includes('local-default-hash'))).toBe(
      false
    )
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash')
  })

  it('prefers remote notes when first joining an existing sync space', async () => {
    const localNotePath = path.join(mocks.notesDir, 'daily.md')
    const localOnlyNotePath = path.join(mocks.notesDir, 'local-only.md')
    await fsp.mkdir(path.dirname(localNotePath), { recursive: true })
    await fsp.writeFile(localNotePath, '# Local Default Note')
    await fsp.writeFile(localOnlyNotePath, '# Local Only Default Note')
    await fsp.utimes(localNotePath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))
    await fsp.utimes(localOnlyNotePath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))

    const remoteContent = Buffer.from('# Remote Synced Note', 'utf8')
    const valueHash = sha256Buffer(remoteContent)
    const remoteRelativePath = notesRemotePath('daily.md', valueHash)
    const remoteNotePath = `/remote-root/sync/v1/${remoteRelativePath}`
    mocks.remoteFiles.set(remoteNotePath, remoteContent)
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 3,
        updatedAt: 1760000000000,
        records: {},
        syncSpace: {
          version: 1,
          id: 'sync-space-existing',
          createdAt: 1760000000000,
          keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
          keyFormat: 'cherry-sync-space-key-v1',
          secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
        },
        notes: {
          version: 1,
          updatedAt: 1760000000000,
          files: {
            'daily.md': {
              version: 1,
              relativePath: 'daily.md',
              valueHash,
              byteSize: remoteContent.byteLength,
              updatedAt: Date.parse('2026-06-01T12:00:00.000Z'),
              deletedAt: null,
              deviceId: 'remote-device',
              path: remoteRelativePath
            }
          }
        }
      })
    )

    const summary = await new AppDataSyncService().syncNow(config)

    await expect(fsp.readFile(localNotePath, 'utf8')).resolves.toBe('# Remote Synced Note')
    await expect(fsp.readFile(localOnlyNotePath, 'utf8')).resolves.toBe('# Local Only Default Note')
    expect(summary.downloaded).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/notes/files/'))
    ).toBe(false)
  })

  it('downloads remote notes that appear after a local first-join defer', async () => {
    const relativePath = 'daily.md'
    const localContent = Buffer.from('# Local Default Note', 'utf8')
    const localHash = sha256Buffer(localContent)
    const localNotePath = path.join(mocks.notesDir, relativePath)
    await fsp.mkdir(path.dirname(localNotePath), { recursive: true })
    await fsp.writeFile(localNotePath, localContent)
    await fsp.utimes(localNotePath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))

    const remoteContent = Buffer.from('# Remote User Note', 'utf8')
    const remoteHash = sha256Buffer(remoteContent)
    const remoteRelativePath = notesRemotePath(relativePath, remoteHash)
    mocks.remoteFiles.set(`/remote-root/sync/v1/${remoteRelativePath}`, remoteContent)
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 4,
        updatedAt: 1760000000000,
        records: {},
        notes: {
          version: 1,
          updatedAt: 1760000000000,
          files: {
            [relativePath]: {
              version: 1,
              relativePath,
              valueHash: remoteHash,
              byteSize: remoteContent.byteLength,
              updatedAt: Date.parse('2026-06-01T12:00:00.000Z'),
              deletedAt: null,
              deviceId: 'remote-device',
              path: remoteRelativePath
            }
          }
        }
      })
    )
    const syncKey = notesSyncStateKey('local-device', relativePath)
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === syncKey ? `deferred-local:content:${localHash}` : null
    )

    const summary = await new AppDataSyncService().syncNow(config)

    await expect(fsp.readFile(localNotePath, 'utf8')).resolves.toBe('# Remote User Note')
    expect(summary.downloaded).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/notes/files/'))
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(syncKey, `content:${remoteHash}`)
  })

  it('prefers remote runtime directories when first joining an existing sync space', async () => {
    const localSkillPath = path.join(mocks.runtimeDataRoot, 'Skills', 'sync-fixture', 'SKILL.md')
    const localOnlyMcpPath = path.join(mocks.runtimeDataRoot, 'MCP', 'local-server.json')
    await fsp.mkdir(path.dirname(localSkillPath), { recursive: true })
    await fsp.mkdir(path.dirname(localOnlyMcpPath), { recursive: true })
    await fsp.writeFile(localSkillPath, '# Local Default Skill')
    await fsp.writeFile(localOnlyMcpPath, '{"name":"local-only"}')
    await fsp.utimes(localSkillPath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))
    await fsp.utimes(localOnlyMcpPath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))

    const remoteBundle = createRuntimeDirectoryBundle({
      name: 'Skills',
      relativePath: 'sync-fixture/SKILL.md',
      content: '# Remote Synced Skill',
      updatedAt: Date.parse('2026-06-01T12:00:00.000Z')
    })
    const remoteBundlePath = `/remote-root/sync/v1/runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`
    mocks.remoteFiles.set(remoteBundlePath, remoteBundle.compressed)
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 7,
        updatedAt: 1760000000000,
        records: {},
        syncSpace: {
          version: 1,
          id: 'sync-space-existing',
          createdAt: 1760000000000,
          keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
          keyFormat: 'cherry-sync-space-key-v1',
          secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
        },
        runtimeDirectories: {
          version: 1,
          updatedAt: 1760000000000,
          directories: {
            Skills: {
              version: 1,
              name: 'Skills',
              valueHash: remoteBundle.valueHash,
              byteSize: remoteBundle.byteSize,
              compressedByteSize: remoteBundle.compressed.byteLength,
              fileCount: remoteBundle.fileCount,
              updatedAt: Date.parse('2026-06-01T12:00:00.000Z'),
              deviceId: 'remote-device',
              path: `runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`
            }
          }
        }
      })
    )

    const summary = await new AppDataSyncService().syncNow(config)

    await expect(fsp.readFile(localSkillPath, 'utf8')).resolves.toBe('# Remote Synced Skill')
    await expect(fsp.readFile(localOnlyMcpPath, 'utf8')).resolves.toBe('{"name":"local-only"}')
    expect(summary.downloaded).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) =>
        String(filePath).includes('/runtime-directories/bundles/')
      )
    ).toBe(false)
  })

  it('downloads remote runtime directories that appear after a local first-join defer', async () => {
    const relativePath = 'sync-fixture/SKILL.md'
    const localContent = '# Local Default Skill'
    const localSkillPath = path.join(mocks.runtimeDataRoot, 'Skills', relativePath)
    await fsp.mkdir(path.dirname(localSkillPath), { recursive: true })
    await fsp.writeFile(localSkillPath, localContent)
    await fsp.utimes(localSkillPath, new Date('2026-06-06T12:00:00.000Z'), new Date('2026-06-06T12:00:00.000Z'))
    const localBundle = createRuntimeDirectoryBundle({
      name: 'Skills',
      relativePath,
      content: localContent,
      updatedAt: Date.parse('2026-06-06T12:00:00.000Z')
    })

    const remoteBundle = createRuntimeDirectoryBundle({
      name: 'Skills',
      relativePath,
      content: '# Remote User Skill',
      updatedAt: Date.parse('2026-06-01T12:00:00.000Z')
    })
    mocks.remoteFiles.set(
      `/remote-root/sync/v1/runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`,
      remoteBundle.compressed
    )
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 8,
        updatedAt: 1760000000000,
        records: {},
        runtimeDirectories: {
          version: 1,
          updatedAt: 1760000000000,
          directories: {
            Skills: {
              version: 1,
              name: 'Skills',
              valueHash: remoteBundle.valueHash,
              byteSize: remoteBundle.byteSize,
              compressedByteSize: remoteBundle.compressed.byteLength,
              fileCount: remoteBundle.fileCount,
              updatedAt: Date.parse('2026-06-01T12:00:00.000Z'),
              deviceId: 'remote-device',
              path: `runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`
            }
          }
        }
      })
    )
    const syncKey = runtimeDirectorySyncStateKey('local-device', 'Skills')
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === syncKey ? `deferred-local:content:${localBundle.valueHash}` : null
    )

    const summary = await new AppDataSyncService().syncNow(config)

    await expect(fsp.readFile(localSkillPath, 'utf8')).resolves.toBe('# Remote User Skill')
    expect(summary.downloaded).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) =>
        String(filePath).includes('/runtime-directories/bundles/')
      )
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(syncKey, `content:${remoteBundle.valueHash}`)
  })

  it('downloads remote runtime directories when the local directory is missing after a previous sync', async () => {
    const relativePath = 'sync-fixture/SKILL.md'
    const localSkillPath = path.join(mocks.runtimeDataRoot, 'Skills', relativePath)
    const remoteBundle = createRuntimeDirectoryBundle({
      name: 'Skills',
      relativePath,
      content: '# Remote Recovery Skill',
      updatedAt: Date.parse('2026-06-01T12:00:00.000Z')
    })
    mocks.remoteFiles.set(
      `/remote-root/sync/v1/runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`,
      remoteBundle.compressed
    )
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/manifest.json',
      JSON.stringify({
        version: 1,
        generation: 9,
        updatedAt: 1760000000000,
        records: {},
        runtimeDirectories: {
          version: 1,
          updatedAt: 1760000000000,
          directories: {
            Skills: {
              version: 1,
              name: 'Skills',
              valueHash: remoteBundle.valueHash,
              byteSize: remoteBundle.byteSize,
              compressedByteSize: remoteBundle.compressed.byteLength,
              fileCount: remoteBundle.fileCount,
              updatedAt: Date.parse('2026-06-01T12:00:00.000Z'),
              deviceId: 'remote-device',
              path: `runtime-directories/bundles/Skills/${remoteBundle.valueHash}.json.gz`
            }
          }
        }
      })
    )
    const syncKey = runtimeDirectorySyncStateKey('local-device', 'Skills')
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === syncKey ? `content:${remoteBundle.valueHash}` : null
    )

    const summary = await new AppDataSyncService().syncNow(config)

    await expect(fsp.readFile(localSkillPath, 'utf8')).resolves.toBe('# Remote Recovery Skill')
    expect(summary.downloaded).toBeGreaterThanOrEqual(1)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) =>
        String(filePath).includes('/runtime-directories/bundles/')
      )
    ).toBe(false)
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(syncKey, `content:${remoteBundle.valueHash}`)
  })

  it('projects previously synced Storage v2 remote records even when the current record sync only skips them', async () => {
    const existingStorageManifest = {
      version: 1,
      records: {
        'agent:agent-1': {
          entityType: 'agent',
          table: 'agents',
          idValues: ['agent-1'],
          valueHash: 'agent-hash',
          updatedAt: 1760000000000,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/agent/agent-1.json'
        },
        'file:file-1': {
          entityType: 'file',
          table: 'files',
          idValues: ['file-1'],
          valueHash: 'file-hash',
          updatedAt: 1760000000001,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/file/file-1.json'
        },
        'kv_record:settings:theme': {
          entityType: 'kv_record',
          table: 'kv_records',
          idValues: ['settings', 'theme'],
          valueHash: 'kv-hash',
          updatedAt: 1760000000002,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/kv_record/theme.json'
        }
      },
      blobs: {
        'blob-1': {
          id: 'blob-1',
          checksum: 'blob-checksum',
          byteSize: 128,
          storagePath: 'blobs/blob-1.bin',
          path: 'storage-v2/blobs/blob-1',
          updatedAt: 1760000000001
        }
      }
    }
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: 1760000000000,
          records: {},
          syncSpace: {
            version: 1,
            id: 'sync-space-existing',
            createdAt: 1760000000000,
            keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
            keyFormat: 'cherry-sync-space-key-v1',
            secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          },
          storageV2: existingStorageManifest
        })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: existingStorageManifest,
      syncStates: [],
      summary: {
        storageUploaded: 0,
        storageDownloaded: 0,
        storageDeleted: 0,
        storageConflicts: 0,
        storageResolvedConflicts: 0,
        storageSkipped: 3,
        blobUploaded: 0,
        blobDownloaded: 0,
        secretUploaded: 0,
        secretDownloaded: 0
      }
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.storageDownloaded).toBe(0)
    expect(summary.storageSkipped).toBe(3)
    expect(mocks.storageRecordSync.sync).toHaveBeenCalledWith(
      mocks.webdav,
      '/remote-root/sync/v1',
      existingStorageManifest,
      expect.objectContaining({
        legacySecretKeyMaterial: undefined,
        preferRemoteOnFirstJoin: true,
        skipWriteAccessProbe: true
      })
    )
    expect(mocks.runtimeProjection.projectAgents).toHaveBeenCalledWith({
      archiveRoot: expect.stringContaining('/tmp/cherry-studio-pi-data-root/legacy/data-sync-runtime-projection-')
    })
    expect(mocks.runtimeProjection.projectFiles).toHaveBeenCalledWith({
      archiveRoot: expect.stringContaining('/tmp/cherry-studio-pi-data-root/legacy/data-sync-runtime-projection-')
    })
    expect(mocks.runtimeProjection.projectAppData).not.toHaveBeenCalled()
    expect(mocks.recovery.projectIfLegacyAppRecordListEmpty).toHaveBeenCalledWith(
      undefined,
      'data-sync-runtime-projection'
    )
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'storage-v2-runtime-projection-hash',
      expect.any(String)
    )
  })

  it('does not prefer remote Storage v2 records after the same sync space was already joined', async () => {
    const existingStorageManifest = {
      version: 1,
      records: {
        'provider:openai': {
          entityType: 'provider',
          table: 'providers',
          idValues: ['openai'],
          valueHash: 'provider-hash',
          updatedAt: 1760000000000,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/provider/openai.json'
        }
      },
      blobs: {}
    }
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) =>
      id === 'data-sync-sync-space-id' ? 'sync-space-existing' : null
    )
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: 1760000000000,
          records: {},
          syncSpace: {
            version: 1,
            id: 'sync-space-existing',
            createdAt: 1760000000000,
            keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
            keyFormat: 'cherry-sync-space-key-v1',
            secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          },
          storageV2: existingStorageManifest
        })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: existingStorageManifest,
      syncStates: [],
      summary: {
        storageUploaded: 0,
        storageDownloaded: 0,
        storageDeleted: 0,
        storageConflicts: 0,
        storageResolvedConflicts: 0,
        storageSkipped: 1,
        blobUploaded: 0,
        blobDownloaded: 0,
        secretUploaded: 0,
        secretDownloaded: 0
      }
    })

    await new AppDataSyncService().syncNow(config)

    expect(mocks.storageRecordSync.sync).toHaveBeenCalledWith(
      mocks.webdav,
      '/remote-root/sync/v1',
      existingStorageManifest,
      expect.objectContaining({
        preferRemoteOnFirstJoin: false,
        skipWriteAccessProbe: true
      })
    )
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('data-sync-sync-space-id', 'sync-space-existing')
  })

  it('does not upload optional full data snapshots by default', async () => {
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(summary.snapshotUploaded).toBe(false)
    expect(mocks.backupManager.backup).not.toHaveBeenCalled()
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/manifest.json'),
      expect.stringContaining('"syncSpace"'),
      { overwrite: true }
    )
  })

  it('uploads an optional full data snapshot when explicitly enabled', async () => {
    process.env.CHERRY_STUDIO_DATA_SYNC_REMOTE_SNAPSHOT = '1'
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.uploaded).toBe(0)
    expect(summary.snapshotUploaded).toBe(true)
    expect(mocks.storageRecordSync.sync).toHaveBeenCalledWith(
      mocks.webdav,
      '/remote-root/sync/v1',
      null,
      expect.objectContaining({
        secretKeyMaterial: expect.any(String),
        legacySecretKeyMaterial: 'https://dav.example.com\nuser\npass',
        beforeRemoteConflictApply: expect.any(Function),
        skipWriteAccessProbe: true
      })
    )
    expect(summary.syncSpaceId).toEqual(expect.stringMatching(/^sync-space-/))
    expect(summary.snapshotFileName).toMatch(/^cherry-studio-pi\.data-sync\.local-device\.\d+\.zip$/)
    expect(summary.snapshotBytes).toBe(6)
    expect(mocks.backupManager.backup).toHaveBeenCalledWith(undefined, summary.snapshotFileName, undefined, false)
    const snapshotUpload = mocks.webdav.putFileContents.mock.calls.find(([filePath]) =>
      String(filePath).includes(`/backups/${summary.snapshotFileName}`)
    )
    expect(snapshotUpload?.[2]).toEqual({ overwrite: true, contentLength: 6 })
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/manifest.json'),
      expect.stringContaining('"syncSpace"'),
      { overwrite: true }
    )
  })

  it('skips optional full data snapshots when the local backup is too large', async () => {
    process.env.CHERRY_STUDIO_DATA_SYNC_REMOTE_SNAPSHOT = '1'
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    const originalStat = fsp.stat
    const statSpy = vi.spyOn(fsp, 'stat').mockImplementation(async (...args: Parameters<typeof fsp.stat>) => {
      const result = await originalStat(...args)
      const filePath = String(args[0])
      if (filePath.includes('cherry-studio-pi.data-sync.local-device')) {
        return { ...result, size: 2 * 1024 * 1024 * 1024 + 1 } as Awaited<ReturnType<typeof fsp.stat>>
      }
      return result
    })

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.status).toBe('success')
      expect(summary.snapshotUploaded).toBe(false)
      expect(mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/backups/'))).toBe(
        false
      )
    } finally {
      statSpy.mockRestore()
    }
  })

  it('prunes stale app-data record and backup artifacts after publishing the manifest', async () => {
    mockDirectoryContentsFromRemoteFiles()
    mocks.remoteFiles.set('/remote-root/sync/v1/.tmp-manifest.json-stale.json', JSON.stringify({ stale: true }))
    mocks.remoteFiles.set('/remote-root/sync/v1/.tmp-.sync.lock.json-stale.json', JSON.stringify({ stale: true }))
    mocks.remoteFiles.set('/remote-root/sync/v1/.cherry-studio-pi-write-test-stale.tmp', 'ok')
    mocks.remoteFiles.set('/remote-root/sync/v1/.cherry-studio-pi-storage-write-test-stale.tmp', 'ok')
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/theme.json', JSON.stringify(remoteRecord))
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/stale-hash.json', JSON.stringify({ stale: true }))
    mocks.remoteFiles.set('/remote-root/sync/v1/backups/old-device-snapshot.zip', Buffer.from('old-backup'))

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.tmp-manifest.json-stale.json')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.tmp-.sync.lock.json-stale.json')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/.cherry-studio-pi-write-test-stale.tmp')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(
      '/remote-root/sync/v1/.cherry-studio-pi-storage-write-test-stale.tmp'
    )
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/records/settings/stale-hash.json')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/backups')
    expect(mocks.webdav.deleteFile).not.toHaveBeenCalledWith('/remote-root/sync/v1/records/settings/theme.json')
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.tmp-manifest.json-stale.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.tmp-.sync.lock.json-stale.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.cherry-studio-pi-write-test-stale.tmp')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.cherry-studio-pi-storage-write-test-stale.tmp')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/records/settings/stale-hash.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/backups/old-device-snapshot.zip')).toBe(false)
  })

  it('does not delete root temp cleanup entries outside the sync root', async () => {
    const insideTempPath = '/remote-root/sync/v1/.tmp-inside.json'
    const outsideTempPath = '/remote-root/other/.tmp-outside.json'
    mocks.remoteFiles.set(insideTempPath, JSON.stringify({ stale: true }))
    mocks.remoteFiles.set(outsideTempPath, JSON.stringify({ shouldStay: true }))
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, generation: 0, updatedAt: 0, records: {} })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.webdav.getDirectoryContents.mockImplementation(async (dirPath: string) => {
      if (dirPath !== '/remote-root/sync/v1') return []

      return [
        {
          type: 'file',
          basename: '.tmp-inside.json',
          filename: '.tmp-inside.json',
          lastmod: '2026-06-01T00:00:00.000Z'
        },
        {
          type: 'file',
          basename: '.tmp-outside.json',
          filename: outsideTempPath,
          lastmod: '2026-06-01T00:00:00.000Z'
        }
      ]
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith(insideTempPath)
    expect(mocks.webdav.deleteFile).not.toHaveBeenCalledWith(outsideTempPath)
    expect(mocks.remoteFiles.has(insideTempPath)).toBe(false)
    expect(mocks.remoteFiles.has(outsideTempPath)).toBe(true)
  })

  it('fails visibly when stale app-data cleanup exceeds the remote file budget after publishing', async () => {
    process.env.CHERRY_STUDIO_DATA_SYNC_CLEANUP_MAX_FILES = '1'
    mockDirectoryContentsFromRemoteFiles()
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/theme.json', JSON.stringify(remoteRecord))
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/stale-hash.json', JSON.stringify({ stale: true }))

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端同步目录旧文件数量过多')

    expect(mocks.remoteFiles.has('/remote-root/sync/v1/manifest.json')).toBe(true)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/records/settings/stale-hash.json')).toBe(true)
  })

  it('prunes the stale app-data records directory in one request when Storage v2 owns app records', async () => {
    mockDirectoryContentsFromRemoteFiles()
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/old-one.json', JSON.stringify({ stale: 1 }))
    mocks.remoteFiles.set('/remote-root/sync/v1/records/settings/old-two.json', JSON.stringify({ stale: 2 }))
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          generation: 0,
          updatedAt: 0,
          records: {},
          snapshots: {},
          latestSnapshot: null,
          storageV2: null
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/records')
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/records/settings/old-one.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/records/settings/old-two.json')).toBe(false)
  })

  it('fails visibly when stale Storage v2 cleanup cannot finish after publishing the manifest', async () => {
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: {
        version: 1,
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: 'storage-theme-hash',
            updatedAt: 1760000000000,
            deletedAt: null,
            version: 1,
            path: 'storage-v2/bundle/storage-theme.json'
          }
        },
        blobs: {},
        bundle: {
          version: 1,
          path: 'storage-v2/bundle/storage-theme.json',
          valueHash: 'storage-bundle-hash',
          recordCount: 1,
          blobCount: 0,
          updatedAt: 1760000000000
        }
      },
      syncStates: [{ id: 'settings:theme', valueHash: 'storage-theme-hash' }],
      summary: {
        storageUploaded: 1,
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
    })
    mocks.storageRecordSync.pruneRemoteArtifacts.mockRejectedValueOnce(new Error('delete denied'))

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('远端旧同步文件清理失败')

    expect(mocks.storageRecordSync.commitRecordSyncStates).toHaveBeenCalledWith([
      { id: 'settings:theme', valueHash: 'storage-theme-hash' }
    ])
    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith('last-sync-summary', expect.anything())
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/manifest.json')).toBe(true)
  })

  it('skips deep remote artifact cleanup when artifact references are unchanged and cleanup is fresh', async () => {
    const existingStorageManifest = {
      version: 1,
      records: {
        'settings:theme': {
          entityType: 'settings',
          table: 'settings',
          idValues: ['theme'],
          valueHash: 'storage-theme-hash',
          updatedAt: 1760000000000,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/bundle/storage-bundle-hash.json'
        }
      },
      blobs: {},
      bundle: {
        version: 1,
        path: 'storage-v2/bundle/storage-bundle-hash.json',
        valueHash: 'storage-bundle-hash',
        recordCount: 1,
        blobCount: 0,
        updatedAt: 1760000000000
      }
    }
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) => {
      if (id === 'data-sync-sync-space-id') return 'sync-space-existing'
      if (id === 'data-sync-last-remote-artifact-cleanup-at') return Date.now()
      return null
    })
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          generation: 3,
          updatedAt: 1760000000000,
          records: {},
          syncSpace: {
            version: 1,
            id: 'sync-space-existing',
            createdAt: 1760000000000,
            keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
            keyFormat: 'cherry-sync-space-key-v1',
            secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          },
          storageV2: existingStorageManifest
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: existingStorageManifest,
      syncStates: [],
      summary: {
        storageUploaded: 0,
        storageDownloaded: 0,
        storageDeleted: 0,
        storageConflicts: 0,
        storageResolvedConflicts: 0,
        storageSkipped: 1,
        blobUploaded: 0,
        blobDownloaded: 0,
        secretUploaded: 0,
        secretDownloaded: 0
      }
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(summary.remoteGeneration).toBe(3)
    expect(mocks.storageRecordSync.pruneRemoteArtifacts).not.toHaveBeenCalled()
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).includes('/.tmp-manifest.json'))
    ).toBe(false)
    expect(mocks.webdav.getDirectoryContents).toHaveBeenCalledWith('/remote-root/sync/v1')
    expect(mocks.webdav.getDirectoryContents).not.toHaveBeenCalledWith('/remote-root/sync/v1/records')
    expect(mocks.webdav.getDirectoryContents).not.toHaveBeenCalledWith('/remote-root/sync/v1/storage-v2/bundle')
    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith(
      'data-sync-last-remote-artifact-cleanup-at',
      expect.anything()
    )
  })

  it('still runs deep remote artifact cleanup when Storage v2 artifact references change', async () => {
    const previousStorageManifest = {
      version: 1,
      records: {},
      blobs: {},
      bundle: {
        version: 1,
        path: 'storage-v2/bundle/old-bundle.json',
        valueHash: 'old-bundle',
        recordCount: 0,
        blobCount: 0,
        updatedAt: 1760000000000
      }
    }
    const nextStorageManifest = {
      version: 1,
      records: {
        'settings:theme': {
          entityType: 'settings',
          table: 'settings',
          idValues: ['theme'],
          valueHash: 'storage-theme-hash',
          updatedAt: 1760000000001,
          deletedAt: null,
          version: 1,
          path: 'storage-v2/bundle/new-bundle.json'
        }
      },
      blobs: {},
      bundle: {
        version: 1,
        path: 'storage-v2/bundle/new-bundle.json',
        valueHash: 'new-bundle',
        recordCount: 1,
        blobCount: 0,
        updatedAt: 1760000000001
      }
    }
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) => {
      if (id === 'data-sync-sync-space-id') return 'sync-space-existing'
      if (id === 'data-sync-last-remote-artifact-cleanup-at') return Date.now()
      return null
    })
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          generation: 3,
          updatedAt: 1760000000000,
          records: {},
          syncSpace: {
            version: 1,
            id: 'sync-space-existing',
            createdAt: 1760000000000,
            keyMaterial: 'abcdefghijklmnopqrstuvwxyz123456',
            keyFormat: 'cherry-sync-space-key-v1',
            secretEncryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          },
          storageV2: previousStorageManifest
        })
      }

      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.storageRecordSync.sync.mockResolvedValueOnce({
      manifest: nextStorageManifest,
      syncStates: [{ id: 'settings:theme', valueHash: 'storage-theme-hash' }],
      summary: {
        storageUploaded: 1,
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
    })

    await new AppDataSyncService().syncNow(config)

    const manifestWrite = mocks.webdav.putFileContents.mock.calls.find(([filePath]) =>
      String(filePath).endsWith('/manifest.json')
    )
    expect(manifestWrite).toBeTruthy()
    expect(JSON.parse(String(manifestWrite?.[1]))).toEqual(
      expect.objectContaining({
        generation: 4,
        storageV2: nextStorageManifest
      })
    )
    expect(mocks.storageRecordSync.pruneRemoteArtifacts).toHaveBeenCalledWith(
      mocks.webdav,
      '/remote-root/sync/v1',
      nextStorageManifest,
      expect.objectContaining({ assertActive: expect.any(Function) })
    )
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'data-sync-last-remote-artifact-cleanup-at',
      expect.any(Number)
    )
  })

  it('keeps data sync successful when the optional full snapshot upload is unavailable', async () => {
    process.env.CHERRY_STUDIO_DATA_SYNC_REMOTE_SNAPSHOT = '1'
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.webdav.putFileContents.mockImplementation(async (filePath: string, contents: unknown, options?: any) => {
      if (String(filePath).includes('/backups/')) {
        throw new Error('Invalid response: 503 Service Unavailable')
      }
      if (options?.overwrite === false && mocks.remoteFiles.has(filePath)) {
        return false
      }
      mocks.remoteFiles.set(filePath, await normalizeUploadedContents(contents))
      return true
    })

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.status).toBe('success')
    expect(summary.snapshotUploaded).toBe(false)
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('last-sync-summary', expect.any(Object))
  })

  it('skips full data snapshots when this device already uploaded a fresh one', async () => {
    const uploadedAt = 1760000000000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(uploadedAt + 60_000)
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({
          version: 1,
          updatedAt: uploadedAt,
          records: {},
          snapshots: {
            'local-device': {
              id: 'local-device',
              fileName: 'cherry-studio-pi.data-sync.local-device.zip',
              path: 'backups/cherry-studio-pi.data-sync.local-device.zip',
              byteSize: 6,
              createdAt: new Date(uploadedAt).toISOString(),
              uploadedAt,
              deviceId: 'local-device',
              format: 'cherry-studio-direct-backup-zip'
            }
          }
        })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })

    try {
      const summary = await new AppDataSyncService().syncNow(config)

      expect(summary.snapshotUploaded).toBe(false)
      expect(mocks.backupManager.backup).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('does not duplicate Storage v2 app records into legacy WebDAV record files', async () => {
    const legacyRecord = {
      ...remoteRecord,
      value: { mode: 'legacy' },
      valueHash: 'legacy-theme-hash',
      updatedAt: 1760000000001,
      deviceId: 'legacy-device',
      version: 1
    }
    const storageThemeRecord = {
      ...remoteRecord,
      value: { mode: 'storage-v2' },
      valueHash: 'storage-theme-hash',
      updatedAt: 1760000000002,
      deviceId: 'storage-v2-device',
      version: 2
    }
    const storageOnlyRecord = {
      scope: 'agent-tools',
      key: 'github',
      value: { enabled: true },
      valueHash: 'storage-github-hash',
      updatedAt: 1760000000003,
      deletedAt: null,
      deviceId: 'storage-v2-device',
      version: 1
    }

    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) {
        return mocks.remoteFiles.get(filePath)
      }

      if (filePath.endsWith('/manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: 0, records: {} })
      }
      throw new Error(`Unexpected WebDAV read: ${filePath}`)
    })
    mocks.db.listRecords.mockResolvedValue([legacyRecord])
    mocks.storageV2.listRecords.mockResolvedValueOnce([storageThemeRecord, storageOnlyRecord])

    const summary = await new AppDataSyncService().syncNow(config)

    expect(summary.uploaded).toBe(0)
    expect(mocks.storageV2.listRecords).toHaveBeenCalledWith(undefined, true)
    expect([...mocks.remoteFiles.keys()].some((filePath) => String(filePath).includes('/records/'))).toBe(false)
    expect(JSON.parse(String(mocks.remoteFiles.get('/remote-root/sync/v1/manifest.json'))).records).toEqual({})
  })

  it('reads sync status summary from Storage v2 when the legacy app database is missing it', async () => {
    const storageSummary = {
      uploaded: 1,
      downloaded: 2,
      deleted: 0,
      conflicts: 0,
      resolvedConflicts: 0,
      skipped: 3,
      lastSyncAt: 1760000000300
    }
    mocks.db.getSyncState.mockResolvedValue(null)
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) =>
      id === 'last-sync-summary' ? storageSummary : null
    )

    await expect(new AppDataSyncService().getStatus()).resolves.toEqual({
      deviceId: 'local-device',
      lastSummary: storageSummary,
      conflicts: [],
      syncing: false,
      syncStartedAt: null
    })
    expect(mocks.storageV2.getSyncState).toHaveBeenCalledWith('last-sync-summary')
  })

  it('preserves remote runtime summary details when recording renderer recovery failures', async () => {
    const previousSummary = {
      status: 'success',
      error: null,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      resolvedConflicts: 0,
      skipped: 4,
      storageDownloaded: 3,
      storageRecordCount: 3,
      storageBlobCount: 1,
      storageBundleHash: 'remote-bundle-hash',
      remotePath: '/remote-root/sync/v1',
      lastSyncAt: 1760000000300
    }
    mocks.db.getSyncState.mockImplementation(async (id: string) =>
      id === 'last-sync-summary' ? previousSummary : null
    )

    await new AppDataSyncService().recordSyncFailure(new Error('hydrate failed'), { preserveLastSummary: true })

    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'last-sync-summary',
      expect.objectContaining({
        status: 'failed',
        error: 'hydrate failed',
        storageDownloaded: 3,
        storageRecordCount: 3,
        storageBlobCount: 1,
        storageBundleHash: 'remote-bundle-hash',
        remotePath: '/remote-root/sync/v1'
      })
    )
  })

  it('uses the Storage v2 app sync device id when legacy app.db is missing the original one', async () => {
    mocks.storageV2.getSyncState.mockImplementation(async (id: string) =>
      id === 'device-id' ? 'storage-device' : null
    )

    await expect(new AppDataSyncService().getStatus()).resolves.toEqual({
      deviceId: 'storage-device',
      lastSummary: expect.any(Object),
      conflicts: [],
      syncing: false,
      syncStartedAt: null
    })
    expect(mocks.storageV2.getSyncState).toHaveBeenCalledWith('device-id')
  })

  it('reads unresolved sync conflicts from Storage v2 when legacy app.db has none', async () => {
    const storageConflict = {
      id: 'settings:theme:1760000000999',
      scope: 'settings',
      key: 'theme',
      local_value: { mode: 'light' },
      remote_value: { mode: 'dark' },
      base_hash: 'base-hash',
      local_hash: 'local-hash',
      remote_hash: 'remote-hash',
      created_at: 1760000000999,
      resolved_at: null
    }
    mocks.db.listConflicts.mockResolvedValueOnce([])
    mocks.storageV2.listSyncConflicts.mockResolvedValueOnce([storageConflict])

    await expect(new AppDataSyncService().getStatus()).resolves.toEqual({
      deviceId: 'local-device',
      lastSummary: expect.any(Object),
      conflicts: [storageConflict],
      syncing: false,
      syncStartedAt: null
    })
    expect(mocks.storageV2.listSyncConflicts).toHaveBeenCalledWith(true)
  })

  it('reports in-flight sync status and rejects concurrent sync attempts', async () => {
    const pendingDirectoryCheck = deferred<boolean>()
    mocks.webdav.exists.mockReturnValueOnce(pendingDirectoryCheck.promise)
    const service = new AppDataSyncService()
    const firstSync = service.syncNow(config)

    await expect(service.syncNow(config)).rejects.toThrow('Data sync is already running')
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: true,
        syncStartedAt: expect.any(Number)
      })
    )

    pendingDirectoryCheck.resolve(true)
    await expect(firstSync).resolves.toEqual(expect.objectContaining({ status: 'success' }))
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: false,
        syncStartedAt: null
      })
    )
  })

  it('clears local in-flight status after the sync runtime deadline even if the background promise is still exiting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T08:00:00.000Z'))
    process.env.CHERRY_STUDIO_DATA_SYNC_MAX_RUNTIME_MS = '1000'
    const pendingStorageSync = deferred<{
      manifest: { version: 1; records: Record<string, never>; blobs: Record<string, never> }
      syncStates: never[]
      summary: {
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
    }>()
    mocks.storageRecordSync.sync.mockReturnValueOnce(pendingStorageSync.promise)

    const service = new AppDataSyncService()
    const sync = service.syncNow(config)

    await vi.waitFor(() => expect(mocks.storageRecordSync.sync).toHaveBeenCalled())
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: true,
        syncStartedAt: expect.any(Number)
      })
    )

    const lockPath = mocks.webdav.putFileContents.mock.calls
      .map(([filePath]) => String(filePath))
      .find((filePath) => filePath.includes('/.sync.locks/'))
    expect(lockPath).toBeTruthy()
    const lockWritesBeforeTimeout = mocks.webdav.putFileContents.mock.calls.filter(
      ([filePath]) => String(filePath) === lockPath
    ).length

    const timeoutExpectation = expect(sync).rejects.toThrow('同步超过 1 秒仍未完成')
    await vi.advanceTimersByTimeAsync(1001)
    await timeoutExpectation
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith(
      'last-sync-summary',
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('同步超过 1 秒仍未完成')
      })
    )
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: false,
        syncStartedAt: null
      })
    )

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.webdav.putFileContents.mock.calls.filter(([filePath]) => String(filePath) === lockPath)).toHaveLength(
      lockWritesBeforeTimeout
    )

    pendingStorageSync.resolve({
      manifest: { version: 1, records: {}, blobs: {} },
      syncStates: [],
      summary: {
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
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(
      mocks.webdav.putFileContents.mock.calls.some(([filePath]) => String(filePath).endsWith('/manifest.json'))
    ).toBe(false)
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: false,
        syncStartedAt: null
      })
    )
  })

  it('allows a retry after the local sync runtime deadline while the stale background promise exits safely', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T08:00:00.000Z'))
    process.env.CHERRY_STUDIO_DATA_SYNC_MAX_RUNTIME_MS = '1000'
    const pendingStorageSync = deferred<{
      manifest: { version: 1; records: Record<string, never>; blobs: Record<string, never> }
      syncStates: never[]
      summary: {
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
    }>()
    mocks.storageRecordSync.sync.mockReturnValueOnce(pendingStorageSync.promise)

    const service = new AppDataSyncService()
    const sync = service.syncNow(config)
    await vi.waitFor(() => expect(mocks.storageRecordSync.sync).toHaveBeenCalledTimes(1))

    const timeoutExpectation = expect(sync).rejects.toThrow('同步超过 1 秒仍未完成')
    await vi.advanceTimersByTimeAsync(1001)
    await timeoutExpectation
    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        syncing: false,
        syncStartedAt: null
      })
    )

    await expect(service.syncNow(config)).resolves.toEqual(expect.objectContaining({ status: 'success' }))
    expect(mocks.storageRecordSync.sync).toHaveBeenCalledTimes(2)

    pendingStorageSync.resolve({
      manifest: { version: 1, records: {}, blobs: {} },
      syncStates: [],
      summary: {
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
    })
    await vi.advanceTimersByTimeAsync(0)
  })
})
