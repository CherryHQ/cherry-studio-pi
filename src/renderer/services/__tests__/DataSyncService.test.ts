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
  syncNow: vi.fn(),
  recordFailure: vi.fn(),
  onExternalSyncCompleted: vi.fn(),
  onLocalStorageV2Changed: vi.fn(),
  externalSyncListener: null as ((payload: unknown) => void) | null,
  localStorageV2ChangeListener: null as ((payload: unknown) => void) | null,
  externalSyncUnsubscribe: vi.fn(),
  localStorageV2ChangeUnsubscribe: vi.fn()
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
  type DataSyncSummary,
  getDataSyncRuntimeState,
  refreshDataSyncRuntimeStateFromMain,
  startDataSyncAutoSync,
  startDataSyncExternalSyncListener,
  stopDataSyncAutoSync,
  stopDataSyncExternalSyncListener,
  subscribeDataSyncRuntimeState,
  syncAppDataNow
} from '../DataSyncService'

const successSummary: DataSyncSummary = {
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
  storageBundleHash: null,
  storageRecordCount: 0,
  storageBlobCount: 0,
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
          syncNow: mocks.syncNow,
          recordFailure: mocks.recordFailure,
          onExternalSyncCompleted: mocks.onExternalSyncCompleted,
          onLocalStorageV2Changed: mocks.onLocalStorageV2Changed
        }
      }
    })
    mocks.externalSyncListener = null
    mocks.localStorageV2ChangeListener = null
    mocks.onExternalSyncCompleted.mockImplementation((listener: (payload: unknown) => void) => {
      mocks.externalSyncListener = listener
      return mocks.externalSyncUnsubscribe
    })
    mocks.onLocalStorageV2Changed.mockImplementation((listener: (payload: unknown) => void) => {
      mocks.localStorageV2ChangeListener = listener
      return mocks.localStorageV2ChangeUnsubscribe
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
    stopDataSyncExternalSyncListener()
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

  it('hydrates runtime after an external main-process sync completion event', async () => {
    startDataSyncExternalSyncListener()

    expect(mocks.onExternalSyncCompleted).toHaveBeenCalledTimes(1)
    mocks.externalSyncListener?.({
      source: 'agent',
      summary: {
        ...successSummary,
        storageRecordCount: 4,
        storageBundleHash: 'remote-bundle-hash'
      }
    })

    await vi.waitFor(() => {
      expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(1)
    })
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after external data sync', {
      strict: true
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
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      expect.stringContaining('远端数据已同步到本机，但恢复到当前界面失败')
    )
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
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      expect.stringContaining('远端数据已同步到本机，但恢复到当前界面失败：hydrate failed')
    )
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

  it('keeps notifying healthy subscribers when another runtime subscriber throws', async () => {
    const pendingSync = deferred<typeof successSummary>()
    const brokenSubscriber = vi.fn(() => {
      throw new Error('listener failed')
    })
    const healthySubscriber = vi.fn()
    let unsubscribeBroken: () => void = () => {}
    let unsubscribeHealthy: () => void = () => {}
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)

    try {
      expect(() => {
        unsubscribeBroken = subscribeDataSyncRuntimeState(brokenSubscriber)
        unsubscribeHealthy = subscribeDataSyncRuntimeState(healthySubscriber)
      }).not.toThrow()

      const sync = syncAppDataNow()
      await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

      expect(healthySubscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          syncing: true,
          syncStartedAt: expect.any(Number)
        })
      )

      pendingSync.resolve(successSummary)
      await expect(sync).resolves.toEqual(successSummary)

      expect(healthySubscriber).toHaveBeenLastCalledWith({
        syncing: false,
        syncStartedAt: null
      })
    } finally {
      unsubscribeBroken()
      unsubscribeHealthy()
    }
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

  it('clears renderer sync state when duplicate preflight status reconciliation times out', async () => {
    vi.useFakeTimers()
    const pendingSync = deferred<typeof successSummary>()
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)

    const firstSync = syncAppDataNow()
    await vi.waitFor(() => expect(mocks.syncNow).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    mocks.getStatus.mockImplementationOnce(() => new Promise(() => undefined))
    const duplicateSync = syncAppDataNow()
    const rejection = expect(duplicateSync).rejects.toThrow('检查当前同步状态')

    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(getDataSyncRuntimeState()).toEqual({
      syncing: false,
      syncStartedAt: null
    })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    pendingSync.resolve(successSummary)
    await expect(firstSync).resolves.toEqual(successSummary)
  })

  it('returns null when the main process rejects because a sync is still running', async () => {
    mocks.syncNow.mockRejectedValueOnce(new Error('已有数据同步正在进行'))

    await expect(syncAppDataNow()).resolves.toBeNull()

    expect(mocks.recordFailure).not.toHaveBeenCalled()
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('reconciles stale renderer sync state when the main process is idle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T03:00:00.000Z'))
    const pendingSync = deferred<typeof successSummary>()
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)

    const firstSync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    vi.setSystemTime(new Date('2026-06-05T03:01:01.000Z'))
    await expect(refreshDataSyncRuntimeStateFromMain()).resolves.toEqual({
      syncing: false,
      syncStartedAt: null
    })

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

  it('fails and records a renderer-stage timeout when local sync preparation hangs', async () => {
    vi.useFakeTimers()
    const pendingPrepare = deferred<void>()
    mocks.prepareStorageV2ForDataSync.mockReturnValueOnce(pendingPrepare.promise)

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))
    const rejection = expect(sync).rejects.toThrow('准备本机数据')

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    await rejection
    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(mocks.recordFailure).toHaveBeenCalledWith(expect.stringContaining('准备本机数据'))
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('fails and records a renderer-stage timeout when the main sync IPC never returns', async () => {
    vi.useFakeTimers()
    const pendingSync = deferred<typeof successSummary>()
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))
    const rejection = expect(sync).rejects.toThrow('执行 WebDAV 同步')

    await vi.advanceTimersByTimeAsync(15 * 60_000)

    await rejection
    expect(mocks.recordFailure).toHaveBeenCalledWith(expect.stringContaining('执行 WebDAV 同步'))
    expect(getDataSyncRuntimeState().syncing).toBe(false)
  })

  it('does not hang when status inspection also stalls after a main sync timeout', async () => {
    vi.useFakeTimers()
    const pendingSync = deferred<typeof successSummary>()
    const idleStatus = {
      syncing: false,
      lastSummary: null,
      conflicts: [],
      syncStartedAt: null
    }
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)
    mocks.getStatus
      .mockResolvedValueOnce(idleStatus)
      .mockResolvedValueOnce(idleStatus)
      .mockImplementation(
        () =>
          new Promise(() => {
            // Simulate a wedged status IPC after the WebDAV sync IPC has already timed out.
          })
      )

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))
    const rejection = expect(sync).rejects.toThrow('执行 WebDAV 同步')

    await vi.advanceTimersByTimeAsync(15 * 60_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(mocks.recordFailure).toHaveBeenCalledWith(expect.stringContaining('执行 WebDAV 同步'))
    expect(getDataSyncRuntimeState()).toEqual({
      syncing: false,
      syncStartedAt: null
    })
  })

  it('hydrates a delayed main-process result when status inspection stalls after a sync timeout', async () => {
    vi.useFakeTimers()
    const pendingSync = deferred<typeof successSummary>()
    const idleStatus = {
      syncing: false,
      lastSummary: null,
      conflicts: [],
      syncStartedAt: null
    }
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)
    mocks.getStatus
      .mockResolvedValueOnce(idleStatus)
      .mockResolvedValueOnce(idleStatus)
      .mockImplementation(
        () =>
          new Promise(() => {
            // Simulate a wedged status IPC while the main-process sync eventually finishes.
          })
      )

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))
    const rejection = expect(sync).rejects.toThrow('执行 WebDAV 同步')

    await vi.advanceTimersByTimeAsync(15 * 60_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(getDataSyncRuntimeState()).toEqual({
      syncing: false,
      syncStartedAt: null
    })

    pendingSync.resolve({
      ...successSummary,
      storageDownloaded: 2,
      storageRecordCount: 3,
      storageBundleHash: 'remote-bundle-hash'
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.waitFor(() => {
      expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(1)
    })
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after delayed data sync', {
      strict: true
    })
  })

  it('recovers a completed main-process summary when the sync IPC times out after success', async () => {
    vi.useFakeTimers()
    const startedAt = Date.parse('2026-06-06T10:00:00.000Z')
    vi.setSystemTime(new Date(startedAt))
    const pendingSync = deferred<typeof successSummary>()
    const recoveredSummary = {
      ...successSummary,
      storageDownloaded: 2,
      storageRecordCount: 3,
      storageBundleHash: 'remote-bundle-hash',
      lastSyncAt: startedAt + 1_000
    }
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)
    mocks.getStatus
      .mockResolvedValueOnce({ syncing: false, lastSummary: null, conflicts: [], syncStartedAt: null })
      .mockResolvedValueOnce({ syncing: false, lastSummary: null, conflicts: [], syncStartedAt: null })
      .mockResolvedValueOnce({
        syncing: false,
        lastSummary: recoveredSummary,
        conflicts: [],
        syncStartedAt: null
      })
      .mockResolvedValueOnce({
        syncing: false,
        lastSummary: recoveredSummary,
        conflicts: [],
        syncStartedAt: null
      })

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    await vi.advanceTimersByTimeAsync(15 * 60_000)

    await expect(sync).resolves.toEqual(recoveredSummary)
    expect(mocks.recordFailure).not.toHaveBeenCalled()
    expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(1)
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith(
      'data-sync:after timed-out data sync status recovery',
      { strict: true }
    )
    expect(getDataSyncRuntimeState()).toEqual({
      syncing: false,
      syncStartedAt: null
    })
  })

  it('keeps renderer runtime busy when a main sync timeout leaves the main process running', async () => {
    vi.useFakeTimers()
    const mainStartedAt = Date.parse('2026-06-06T10:00:00.000Z')
    vi.setSystemTime(new Date(mainStartedAt))
    const pendingSync = deferred<typeof successSummary>()
    const states: boolean[] = []
    const unsubscribe = subscribeDataSyncRuntimeState((state) => {
      states.push(state.syncing)
    })
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise)
    mocks.getStatus
      .mockResolvedValueOnce({ syncing: false, lastSummary: null, conflicts: [], syncStartedAt: null })
      .mockResolvedValueOnce({
        syncing: false,
        lastSummary: {
          status: 'success',
          downloaded: 0,
          storageDownloaded: 0,
          blobDownloaded: 0,
          secretDownloaded: 0,
          deleted: 0,
          storageDeleted: 0,
          lastSyncAt: 0
        },
        conflicts: [],
        syncStartedAt: null
      })
      .mockResolvedValueOnce({
        syncing: true,
        lastSummary: null,
        conflicts: [],
        syncStartedAt: mainStartedAt
      })
      .mockResolvedValueOnce({
        syncing: true,
        lastSummary: null,
        conflicts: [],
        syncStartedAt: mainStartedAt
      })
      .mockResolvedValueOnce({
        syncing: false,
        lastSummary: {
          ...successSummary,
          storageDownloaded: 2,
          storageRecordCount: 3,
          storageBundleHash: 'remote-bundle-hash'
        },
        conflicts: [],
        syncStartedAt: null
      })

    const sync = syncAppDataNow()
    await vi.waitFor(() => expect(getDataSyncRuntimeState().syncing).toBe(true))

    await vi.advanceTimersByTimeAsync(15 * 60_000)

    await expect(sync).resolves.toBeNull()
    expect(mocks.recordFailure).not.toHaveBeenCalled()
    expect(getDataSyncRuntimeState()).toEqual({
      syncing: true,
      syncStartedAt: mainStartedAt
    })
    expect(states[0]).toBe(false)
    expect(states.slice(1).every(Boolean)).toBe(true)

    pendingSync.resolve({
      ...successSummary,
      storageDownloaded: 2,
      storageRecordCount: 3,
      storageBundleHash: 'remote-bundle-hash'
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.waitFor(() => {
      expect(mocks.hydrateRuntimeCacheFromStorageV2).toHaveBeenCalledTimes(1)
    })
    expect(mocks.hydrateStorageV2ConversationsIfDexieEmpty).toHaveBeenCalledWith('data-sync:after delayed data sync', {
      strict: true
    })
    await vi.waitFor(() => {
      expect(getDataSyncRuntimeState()).toEqual({
        syncing: false,
        syncStartedAt: null
      })
    })
    await expect(refreshDataSyncRuntimeStateFromMain()).resolves.toEqual({
      syncing: false,
      syncStartedAt: null
    })
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

  it('does not start auto sync until WebDAV credentials are complete', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: '',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 15
      }
    })

    startDataSyncAutoSync(false)
    notifyDataSyncLocalChange('redux')
    await vi.advanceTimersByTimeAsync(20_000)

    expect(mocks.onLocalStorageV2Changed).not.toHaveBeenCalled()
    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
  })

  it('runs a debounced auto sync after main-process Storage v2 data changes', async () => {
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
    expect(mocks.onLocalStorageV2Changed).toHaveBeenCalledTimes(1)

    mocks.localStorageV2ChangeListener?.({
      entityType: 'agent',
      entityId: 'agent-1',
      operation: 'upsert'
    })

    await vi.advanceTimersByTimeAsync(19_999)
    expect(mocks.syncNow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })
    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
  })

  it('runs a debounced auto sync after main-process file data changes', async () => {
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
    expect(mocks.onLocalStorageV2Changed).toHaveBeenCalledTimes(1)

    mocks.localStorageV2ChangeListener?.({
      reason: 'file',
      path: '/notes/daily.md'
    })

    await vi.advanceTimersByTimeAsync(20_000)

    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })
    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed main-process local change reasons', async () => {
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
    expect(mocks.onLocalStorageV2Changed).toHaveBeenCalledTimes(1)

    mocks.localStorageV2ChangeListener?.({
      reason: 'unknown',
      entityType: 'agent',
      entityId: 'agent-1'
    })

    await vi.advanceTimersByTimeAsync(20_000)

    expect(mocks.syncNow).not.toHaveBeenCalled()
    expect(mocks.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
  })

  it('queues main-process file changes that happen while an auto sync is running', async () => {
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
    const pendingSync = deferred<typeof successSummary>()
    mocks.syncNow.mockReturnValueOnce(pendingSync.promise).mockResolvedValue(successSummary)

    startDataSyncAutoSync(true)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })

    mocks.localStorageV2ChangeListener?.({
      reason: 'file',
      source: 'app-capability.notes.write',
      path: '/notes/daily.md'
    })
    pendingSync.resolve(successSummary)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => {
      expect(getDataSyncRuntimeState().syncing).toBe(false)
    })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(2)
    })
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

  it('does not schedule a redundant auto sync for main-process signals emitted while preparing sync data', async () => {
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
      mocks.localStorageV2ChangeListener?.({
        entityType: 'agent',
        entityId: 'agent-1',
        operation: 'upsert'
      })
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

  it('backs off failed auto sync retries and throttles system agent diagnostics', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: 'pass',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 1
      }
    })
    const syncError = new Error('另一台设备正在同步这个 WebDAV 目录')
    mocks.syncNow.mockRejectedValue(syncError)

    startDataSyncAutoSync(true)

    await vi.advanceTimersByTimeAsync(999)
    expect(mocks.syncNow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })
    expect(mocks.reportErrorToSystemAgent).toHaveBeenCalledWith(
      syncError,
      {
        source: 'data-sync.auto',
        domain: 'dataSync'
      },
      {
        dedupeMs: 10 * 60_000
      }
    )

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(2)
    })

    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(mocks.syncNow).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(3)
    })
  })

  it('defers local-change auto syncs to the existing failure retry during backoff', async () => {
    vi.useFakeTimers()
    mocks.getState.mockReturnValue({
      settings: {
        dataSyncWebdavHost: 'https://dav.example.test',
        dataSyncWebdavUser: 'user',
        dataSyncWebdavPass: 'pass',
        dataSyncWebdavPath: '/cherry-studio-pi',
        dataSyncAutoSync: true,
        dataSyncSyncInterval: 1
      }
    })
    mocks.syncNow.mockRejectedValueOnce(new Error('503 Service Unavailable')).mockResolvedValue(successSummary)

    startDataSyncAutoSync(true)

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    })

    notifyDataSyncLocalChange('redux')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 20_000)
    await vi.waitFor(() => {
      expect(mocks.syncNow).toHaveBeenCalledTimes(2)
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
