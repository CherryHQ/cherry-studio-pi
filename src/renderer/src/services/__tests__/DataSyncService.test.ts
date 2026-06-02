import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(() => ({
    settings: {
      dataSyncWebdavHost: 'https://dav.example.test',
      dataSyncWebdavUser: 'user',
      dataSyncWebdavPass: 'pass',
      dataSyncWebdavPath: '/cherry-studio-pi',
      dataSyncAutoSync: false,
      dataSyncSyncInterval: 0
    }
  })),
  hydrateRuntimeCacheFromStorageV2: vi.fn(),
  persistorFlush: vi.fn(),
  prepareStorageV2ForDataSync: vi.fn(),
  reportErrorToSystemAgent: vi.fn(),
  getStatus: vi.fn(),
  syncNow: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    dispatch: mocks.dispatch,
    getState: mocks.getState
  },
  persistor: {
    flush: mocks.persistorFlush
  }
}))

vi.mock('../StorageV2HydrationService', () => ({
  hydrateRuntimeCacheFromStorageV2: mocks.hydrateRuntimeCacheFromStorageV2
}))

vi.mock('../StorageV2Service', () => ({
  prepareStorageV2ForDataSync: mocks.prepareStorageV2ForDataSync
}))

vi.mock('../SystemAgentService', () => ({
  reportErrorToSystemAgent: mocks.reportErrorToSystemAgent
}))

import { getDataSyncRuntimeState, subscribeDataSyncRuntimeState, syncAppDataNow } from '../DataSyncService'

const successSummary = {
  status: 'success' as const,
  error: null,
  uploaded: 0,
  downloaded: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 8,
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageSkipped: 16,
  blobUploaded: 0,
  blobDownloaded: 0,
  snapshotUploaded: false,
  snapshotFileName: null,
  snapshotBytes: 0,
  remotePath: '/cherry-studio-pi/sync/v1',
  lastSyncAt: 1780058147577
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

describe('DataSyncService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    originalApi = window.api
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dataSync: {
          getStatus: mocks.getStatus,
          syncNow: mocks.syncNow
        }
      }
    })
    mocks.prepareStorageV2ForDataSync.mockResolvedValue(undefined)
    mocks.hydrateRuntimeCacheFromStorageV2.mockResolvedValue({})
    mocks.persistorFlush.mockResolvedValue(undefined)
    mocks.getStatus.mockResolvedValue({
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 0,
        blobDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 0
      }
    })
    mocks.syncNow.mockResolvedValue(successSummary)
  })

  afterEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
    vi.restoreAllMocks()
  })

  it('prepares Storage v2 before WebDAV sync and hydrates runtime after success', async () => {
    const config = {
      webdavHost: 'https://dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/shared'
    }

    await expect(syncAppDataNow(config)).resolves.toEqual(successSummary)

    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
    expect(mocks.syncNow).toHaveBeenCalledWith(config)
    expect(mocks.prepareStorageV2ForDataSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncNow.mock.invocationCallOrder[0]
    )
    expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledWith({
      dispatch: mocks.dispatch,
      flush: expect.any(Function)
    })
  })

  it('hydrates previously downloaded remote data before preparing local mirrors', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 12,
        blobDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 1780058000000
      }
    })

    await syncAppDataNow()

    expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(2)
    expect(mocks.hydrateRuntimeCacheFromStorageV2.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareStorageV2ForDataSync.mock.invocationCallOrder[0]
    )
    expect(mocks.prepareStorageV2ForDataSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncNow.mock.invocationCallOrder[0]
    )
  })

  it('hydrates even when the current sync only reports skipped records', async () => {
    await syncAppDataNow()

    expect(mocks.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/cherry-studio-pi'
    })
    expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(1)
  })

  it('does not prepare Storage v2 when WebDAV is not configured', async () => {
    mocks.getState.mockReturnValueOnce({
      settings: {
        dataSyncWebdavHost: '',
        dataSyncWebdavUser: '',
        dataSyncWebdavPass: '',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: false,
        dataSyncSyncInterval: 0
      }
    })

    await expect(syncAppDataNow()).rejects.toThrow('WebDAV host is required')

    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(mocks.hydrateRuntimeCacheFromStorageV2).not.toHaveBeenCalled()
  })

  it('notifies subscribers while a manual sync is running', async () => {
    const pendingSync = deferred<typeof successSummary>()
    const states: boolean[] = []
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)
    const unsubscribe = subscribeDataSyncRuntimeState((state) => {
      states.push(state.syncing)
    })

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    pendingSync.resolve(successSummary)
    await expect(sync).resolves.toEqual(successSummary)

    expect(getDataSyncRuntimeState().syncing).toBe(false)
    expect(states).toContain(true)
    expect(states.at(-1)).toBe(false)
    unsubscribe()
  })

  it('returns null for duplicate manual sync attempts while the first sync is in flight', async () => {
    const pendingSync = deferred<typeof successSummary>()
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)

    const firstSync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    await expect(syncAppDataNow()).resolves.toBeNull()
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    pendingSync.resolve(successSummary)
    await expect(firstSync).resolves.toEqual(successSummary)
  })
})
