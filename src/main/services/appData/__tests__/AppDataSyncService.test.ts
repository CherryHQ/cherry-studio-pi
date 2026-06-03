import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import type { WebDavConfig } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  backupManager: {
    backup: vi.fn(),
    restore: vi.fn()
  },
  remoteFiles: new Map<string, unknown>(),
  webdav: {
    exists: vi.fn(),
    createDirectory: vi.fn(),
    getFileContents: vi.fn(),
    putFileContents: vi.fn(),
    deleteFile: vi.fn(),
    getDirectoryContents: vi.fn(),
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

vi.mock('@main/services/BackupManager', () => ({
  default: vi.fn(() => mocks.backupManager)
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
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.remoteFiles.clear()
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
    mocks.backupManager.backup.mockImplementation(async (_event, fileName: string) => {
      const filePath = path.join('/tmp', fileName)
      await fsp.writeFile(filePath, 'backup')
      return filePath
    })
    mocks.backupManager.restore.mockResolvedValue(undefined)
    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) return true
      return true
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

  it('uses a native WebDAV directory lock when the provider supports LOCK', async () => {
    await new AppDataSyncService().syncNow(config)

    expect(mocks.webdav.lock).toHaveBeenCalledWith('/remote-root/sync/v1', { timeout: 'Second-1800' })
    expect(mocks.webdav.setHeaders).toHaveBeenCalledWith({
      Authorization: 'Basic token',
      If: '(<opaquelocktoken:native-lock>)'
    })
    expect(mocks.webdav.unlock).toHaveBeenCalledWith('/remote-root/sync/v1', 'opaquelocktoken:native-lock')
    expect(mocks.webdav.setHeaders).toHaveBeenLastCalledWith({ Authorization: 'Basic token' })
  })

  it('rejects active remote file locks before mutating records when native locks are unavailable', async () => {
    const now = Date.now()
    mocks.webdav.lock.mockRejectedValueOnce(new Error('Invalid response: 405 Method Not Allowed'))
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

  it('stops before publishing the manifest when a fallback file lock is stolen mid-sync', async () => {
    const uploadedAt = Date.now()
    const lockPath = '/remote-root/sync/v1/.sync.lock.json'
    mocks.webdav.lock.mockRejectedValueOnce(new Error('Invalid response: 405 Method Not Allowed'))
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
      mocks.remoteFiles.set(
        lockPath,
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

  it('prefers remote app records when a device has no prior sync baseline', async () => {
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
    expect(mocks.storageV2.upsertRecordSnapshot).toHaveBeenCalledWith(remoteRecord)
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
    expect(mocks.storageV2.upsertSyncState).toHaveBeenCalledWith('record:settings:theme:hash', 'remote-hash')
    expect(mocks.webdav.putFileContents.mock.calls.some((call) => String(call[1]).includes('local-default-hash'))).toBe(
      false
    )
  })

  it('auto-resolves exact legacy app record conflicts with a deterministic content tie-breaker', async () => {
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

    expect(events).toEqual([])
    expect(mocks.storageV2.upsertSyncConflict).not.toHaveBeenCalled()
    expect(mocks.db.createConflict).not.toHaveBeenCalled()
    expect(mocks.db.applyRemoteRecord).toHaveBeenCalledWith(remoteRecord, { storageV2Mirrored: true })
  })

  it('counts auto-resolved app record conflicts without storing user conflict records', async () => {
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

    expect(mocks.storageV2.upsertSyncConflict).not.toHaveBeenCalled()
    expect(mocks.db.createConflict).not.toHaveBeenCalled()
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

  it('uploads a full data snapshot even when app records are empty', async () => {
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
    expect(mocks.storageRecordSync.sync).toHaveBeenCalledWith(mocks.webdav, '/remote-root/sync/v1', null, {
      secretKeyMaterial: 'https://dav.example.com\nuser\npass'
    })
    expect(summary.snapshotFileName).toMatch(/^cherry-studio-pi\.data-sync\.local-device\.\d+\.zip$/)
    expect(summary.snapshotBytes).toBe(6)
    expect(mocks.backupManager.backup).toHaveBeenCalledWith(undefined, summary.snapshotFileName, undefined, false)
    const snapshotUpload = mocks.webdav.putFileContents.mock.calls.find(([filePath]) =>
      String(filePath).includes(`/backups/${summary.snapshotFileName}`)
    )
    expect(snapshotUpload?.[2]).toEqual({ overwrite: true, contentLength: 6 })
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/manifest.json'),
      expect.stringContaining('"latestSnapshot"'),
      { overwrite: true }
    )
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
    expect(mocks.webdav.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/backups/old-device-snapshot.zip')
    expect(mocks.webdav.deleteFile).not.toHaveBeenCalledWith('/remote-root/sync/v1/records/settings/theme.json')
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.tmp-manifest.json-stale.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.tmp-.sync.lock.json-stale.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.cherry-studio-pi-write-test-stale.tmp')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/.cherry-studio-pi-storage-write-test-stale.tmp')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/records/settings/stale-hash.json')).toBe(false)
    expect(mocks.remoteFiles.has('/remote-root/sync/v1/backups/old-device-snapshot.zip')).toBe(false)
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

  it('fails safely when the required safety snapshot upload is temporarily unavailable', async () => {
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

    await expect(new AppDataSyncService().syncNow(config)).rejects.toThrow('安全快照上传失败')

    expect(mocks.storageV2.upsertSyncState).not.toHaveBeenCalledWith('last-sync-summary', expect.anything())
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
})
