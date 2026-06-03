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
  hydrateStorageV2ConversationsIfDexieEmpty: vi.fn(),
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

vi.mock('../StorageV2ConversationHydrationService', () => ({
  hydrateStorageV2ConversationsIfDexieEmpty: mocks.hydrateStorageV2ConversationsIfDexieEmpty
}))

vi.mock('../StorageV2Service', () => ({
  prepareStorageV2ForDataSync: mocks.prepareStorageV2ForDataSync
}))

vi.mock('../SystemAgentService', () => ({
  reportErrorToSystemAgent: mocks.reportErrorToSystemAgent
}))

import { notifyDataSyncLocalChange } from '../DataSyncLocalChangeSignal'
import {
  getDataSyncRuntimeState,
  startDataSyncAutoSync,
  stopDataSyncAutoSync,
  subscribeDataSyncRuntimeState,
  syncAppDataNow
} from '../DataSyncService'

const successSummary = {
  status: 'success' as const,
  error: null,
  uploaded: 0,
  downloaded: 0,
  deleted: 0,
  conflicts: 0,
  resolvedConflicts: 0,
  skipped: 8,
  storageUploaded: 0,
  storageDownloaded: 0,
  storageDeleted: 0,
  storageConflicts: 0,
  storageResolvedConflicts: 0,
  storageSkipped: 16,
  blobUploaded: 0,
  blobDownloaded: 0,
  secretUploaded: 0,
  secretDownloaded: 0,
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
    mocks.hydrateStorageV2ConversationsIfDexieEmpty.mockResolvedValue(false)
    mocks.persistorFlush.mockResolvedValue(undefined)
    mocks.getStatus.mockResolvedValue({
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 0,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 0
      }
    })
    mocks.syncNow.mockResolvedValue(successSummary)
  })

  afterEach(() => {
    stopDataSyncAutoSync()
    vi.useRealTimers()
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
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after data sync', {
      strict: false
    })
  })

  it('hydrates previously downloaded remote data before preparing local mirrors', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      syncing: false,
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 0,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 1780058000000
      },
      conflicts: [],
      syncStartedAt: null
    })
    mocks.getStatus.mockResolvedValueOnce({
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 12,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 1780058000000
      }
    })

    await syncAppDataNow()

    expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(2)
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledTimes(2)
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

  it('uses strict hydration when the current sync has remote Storage v2 data even without new downloads', async () => {
    mocks.syncNow.mockResolvedValueOnce({
      ...successSummary,
      storageSkipped: 3,
      storageRecordCount: 3,
      storageBundleHash: 'remote-bundle-hash'
    })
    mocks.hydrateStorageV2ConversationsIfDexieEmpty.mockRejectedValueOnce(new Error('conversation hydrate failed'))

    await expect(syncAppDataNow()).rejects.toThrow('远端数据已同步到本机，但恢复到当前界面失败')

    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after data sync', {
      strict: true
    })
  })

  it('fails the manual sync when downloaded remote data cannot be restored to runtime state', async () => {
    mocks.syncNow.mockResolvedValueOnce({
      ...successSummary,
      storageDownloaded: 2,
      secretDownloaded: 1
    })
    mocks.hydrateRuntimeCacheFromStorageV2.mockRejectedValueOnce(new Error('hydrate failed'))

    await expect(syncAppDataNow()).rejects.toThrow('远端数据已同步到本机，但恢复到当前界面失败')

    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('fails the manual sync when downloaded assistant conversations cannot hydrate into Dexie', async () => {
    mocks.syncNow.mockResolvedValueOnce({
      ...successSummary,
      storageDownloaded: 2
    })
    mocks.hydrateStorageV2ConversationsIfDexieEmpty.mockRejectedValueOnce(new Error('conversation hydrate failed'))

    await expect(syncAppDataNow()).rejects.toThrow('远端数据已同步到本机，但恢复到当前界面失败')

    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after data sync', {
      strict: true
    })
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('blocks the next sync when previously downloaded remote data still cannot hydrate', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      syncing: false,
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 1,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 1780058000000
      },
      conflicts: [],
      syncStartedAt: null
    })
    mocks.getStatus.mockResolvedValueOnce({
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 1,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        lastSyncAt: 1780058000000
      }
    })
    mocks.hydrateRuntimeCacheFromStorageV2.mockRejectedValueOnce(new Error('hydrate failed'))

    await expect(syncAppDataNow()).rejects.toThrow('远端数据已同步到本机，但恢复到当前界面失败')

    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('blocks the next sync when previous remote Storage v2 records still cannot hydrate', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      syncing: false,
      lastSummary: null,
      conflicts: [],
      syncStartedAt: null
    })
    mocks.getStatus.mockResolvedValueOnce({
      syncing: false,
      lastSummary: {
        status: 'success',
        downloaded: 0,
        storageDownloaded: 0,
        blobDownloaded: 0,
        secretDownloaded: 0,
        deleted: 0,
        storageDeleted: 0,
        storageRecordCount: 3,
        storageBundleHash: 'remote-bundle-hash',
        lastSyncAt: 1780058000000
      },
      conflicts: [],
      syncStartedAt: null
    })
    mocks.hydrateStorageV2ConversationsIfDexieEmpty.mockRejectedValueOnce(new Error('conversation hydrate failed'))

    await expect(syncAppDataNow()).rejects.toThrow('远端数据已同步到本机，但恢复到当前界面失败')

    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
    expect(mocks.syncNow).not.toHaveBeenCalled()
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

  it('clears runtime sync state and notifies subscribers when a manual sync fails', async () => {
    const states: boolean[] = []
    const unsubscribe = subscribeDataSyncRuntimeState((state) => {
      states.push(state.syncing)
    })
    mocks.syncNow.mockRejectedValueOnce(new Error('Invalid response: 503 Service Unavailable'))

    await expect(syncAppDataNow()).rejects.toThrow('503 Service Unavailable')

    expect(getDataSyncRuntimeState().syncing).toBe(false)
    expect(states).toContain(true)
    expect(states.at(-1)).toBe(false)
    unsubscribe()
  })

  it('runs a debounced auto sync after local Storage v2 data changes', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: 'pass',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 15
      }
    })

    startDataSyncAutoSync(false)
    notifyDataSyncLocalChange('redux')

    await vi.advanceTimersByTimeAsync(19_999)
    expect(mocks.syncNow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })
    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
  })

  it('does not schedule a redundant auto sync for mirror signals emitted while preparing sync data', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: 'pass',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 15
      }
    })
    mocks.prepareStorageV2ForDataSync.mockImplementation(async () => {
      notifyDataSyncLocalChange('redux')
    })

    startDataSyncAutoSync(false)
    notifyDataSyncLocalChange('redux')
    await vi.advanceTimersByTimeAsync(20_000)

    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
  })

  it('reschedules an immediate auto sync when auto sync settings are changed while already running', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: 'pass',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 15
      }
    })

    startDataSyncAutoSync(false)
    startDataSyncAutoSync(true)

    await vi.advanceTimersByTimeAsync(999)
    expect(mocks.syncNow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })
  })

  it('does not sync local Storage v2 changes when auto sync is disabled', async () => {
    vi.useFakeTimers()

    startDataSyncAutoSync(false)
    notifyDataSyncLocalChange('redux')
    await vi.advanceTimersByTimeAsync(20_000)

    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
  })
})
