import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import type { WebDavConfig } from '@renderer/types'

import { subscribeDataSyncLocalChanges, suppressDataSyncLocalChangeNotifications } from './DataSyncLocalChangeSignal'
import { hydrateStorageV2ConversationsIfDexieEmpty } from './StorageV2ConversationHydrationService'
import { hydrateRuntimeCacheFromStorageV2 } from './StorageV2HydrationService'
import { prepareStorageV2ForDataSync } from './StorageV2Service'
import { reportErrorToSystemAgent } from './SystemAgentService'

const logger = loggerService.withContext('DataSyncService')
const LOCAL_CHANGE_AUTO_SYNC_DEBOUNCE_MS = 20_000

export type DataSyncSummary = {
  status?: 'success' | 'failed'
  error?: string | null
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  resolvedConflicts?: number
  skipped: number
  storageUploaded?: number
  storageDownloaded?: number
  storageDeleted?: number
  storageConflicts?: number
  storageResolvedConflicts?: number
  storageSkipped?: number
  blobUploaded?: number
  blobDownloaded?: number
  secretUploaded?: number
  secretDownloaded?: number
  snapshotUploaded?: boolean
  snapshotFileName?: string | null
  snapshotBytes?: number
  remotePath?: string | null
  remoteGeneration?: number | null
  remoteManifestHash?: string | null
  storageBundleHash?: string | null
  storageRecordCount?: number
  storageBlobCount?: number
  lastSyncAt: number
}

let syncTimeout: NodeJS.Timeout | null = null
let localChangeSyncTimeout: NodeJS.Timeout | null = null
let localChangeUnsubscribe: (() => void) | null = null
let autoSyncStarted = false
let syncing = false
let localChangeDuringSync = false
let syncStartedAt: number | null = null
const syncStateListeners = new Set<(state: DataSyncRuntimeState) => void>()

export type DataSyncRuntimeState = {
  syncing: boolean
  syncStartedAt: number | null
}

export function getDataSyncRuntimeState(): DataSyncRuntimeState {
  return {
    syncing,
    syncStartedAt
  }
}

export function subscribeDataSyncRuntimeState(listener: (state: DataSyncRuntimeState) => void) {
  syncStateListeners.add(listener)
  listener(getDataSyncRuntimeState())

  return () => {
    syncStateListeners.delete(listener)
  }
}

function setDataSyncRunning(nextSyncing: boolean) {
  syncing = nextSyncing
  syncStartedAt = nextSyncing ? Date.now() : null
  const nextState = getDataSyncRuntimeState()
  for (const listener of syncStateListeners) {
    listener(nextState)
  }
}

function hasDownloadedRemoteData(summary?: Partial<DataSyncSummary> | null) {
  if (!summary) return false

  return (
    (summary.downloaded ?? 0) > 0 ||
    (summary.storageDownloaded ?? 0) > 0 ||
    (summary.blobDownloaded ?? 0) > 0 ||
    (summary.secretDownloaded ?? 0) > 0 ||
    (summary.deleted ?? 0) > 0 ||
    (summary.storageDeleted ?? 0) > 0
  )
}

function hasRemoteRuntimeData(summary?: Partial<DataSyncSummary> | null) {
  if (!summary) return false

  return (
    hasDownloadedRemoteData(summary) ||
    (summary.storageRecordCount ?? 0) > 0 ||
    (summary.storageBlobCount ?? 0) > 0 ||
    Boolean(summary.storageBundleHash)
  )
}

async function rememberDataSyncFailure(message: string) {
  try {
    await window.api.dataSync.recordFailure?.(message)
  } catch (error) {
    logger.warn('Failed to record renderer data sync failure summary', error as Error)
  }
}

async function hydrateRuntimeCacheAfterDataSync(context: string, options: { strict?: boolean } = {}) {
  try {
    await hydrateRuntimeCacheFromStorageV2({
      dispatch: store.dispatch,
      flush: () => persistor.flush()
    })
    await hydrateStorageV2ConversationsIfDexieEmpty(`data-sync:${context}`, { strict: options.strict })
  } catch (error) {
    logger.warn(`Failed to hydrate runtime cache ${context}`, error as Error)
    if (options.strict) {
      const message = `远端数据已同步到本机，但恢复到当前界面失败：${
        error instanceof Error ? error.message : String(error)
      }`
      await rememberDataSyncFailure(message)
      throw new Error(message)
    }
  }
}

async function hydratePreviouslyDownloadedRemoteData() {
  const status = await window.api.dataSync.getStatus().catch((error) => {
    logger.warn('Failed to inspect previous data sync status before sync', error as Error)
    return null
  })

  if (!hasRemoteRuntimeData(status?.lastSummary)) return

  await hydrateRuntimeCacheAfterDataSync('before data sync', { strict: true })
}

async function isMainProcessRunning() {
  const status = await window.api.dataSync.getStatus().catch((error) => {
    logger.warn('Failed to inspect main-process data sync status', error as Error)
    return null
  })

  return Boolean(status?.syncing)
}

function getWebDavConfig(): WebDavConfig {
  const settings = store.getState().settings
  return {
    webdavHost: settings.dataSyncWebdavHost,
    webdavUser: settings.dataSyncWebdavUser,
    webdavPass: settings.dataSyncWebdavPass,
    webdavPath: settings.dataSyncWebdavPath
  }
}

function getAutoSyncIntervalMs() {
  const settings = store.getState().settings
  if (!settings.dataSyncAutoSync || !settings.dataSyncWebdavHost || settings.dataSyncSyncInterval <= 0) {
    return null
  }

  return settings.dataSyncSyncInterval * 60 * 1000
}

function clearLocalChangeSyncTimeout() {
  if (!localChangeSyncTimeout) return

  clearTimeout(localChangeSyncTimeout)
  localChangeSyncTimeout = null
}

function scheduleLocalChangeSync(delayMs = LOCAL_CHANGE_AUTO_SYNC_DEBOUNCE_MS) {
  if (!autoSyncStarted || getAutoSyncIntervalMs() === null) return

  clearLocalChangeSyncTimeout()
  localChangeSyncTimeout = setTimeout(() => {
    localChangeSyncTimeout = null
    void performAutoSync()
  }, delayMs)

  logger.info('Data sync scheduled after local Storage v2 change', { delayMs })
}

function ensureLocalChangeAutoSyncSubscription() {
  if (localChangeUnsubscribe) return

  localChangeUnsubscribe = subscribeDataSyncLocalChanges((event) => {
    if (!autoSyncStarted || getAutoSyncIntervalMs() === null) return

    if (syncing) {
      localChangeDuringSync = true
      logger.debug('Queued data sync after current sync because local Storage v2 changed', {
        reason: event.reason
      })
      return
    }

    scheduleLocalChangeSync()
  })
}

export async function syncAppDataNow(configOverride?: WebDavConfig): Promise<DataSyncSummary | null> {
  if (syncing) {
    logger.info('Data sync already running')
    return null
  }

  const config = configOverride ?? getWebDavConfig()
  if (!config.webdavHost) {
    throw new Error('WebDAV host is required')
  }

  if (await isMainProcessRunning()) {
    logger.info('Data sync already running in main process')
    return null
  }

  setDataSyncRunning(true)
  clearLocalChangeSyncTimeout()
  try {
    await hydratePreviouslyDownloadedRemoteData()
    await suppressDataSyncLocalChangeNotifications(() => prepareStorageV2ForDataSync())
    const summary = await window.api.dataSync.syncNow(config)
    await hydrateRuntimeCacheAfterDataSync('after data sync', { strict: hasRemoteRuntimeData(summary) })
    return summary
  } finally {
    setDataSyncRunning(false)
    if (localChangeDuringSync) {
      localChangeDuringSync = false
      scheduleLocalChangeSync()
    }
  }
}

export function stopDataSyncAutoSync() {
  autoSyncStarted = false
  localChangeDuringSync = false
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  clearLocalChangeSyncTimeout()
  if (localChangeUnsubscribe) {
    localChangeUnsubscribe()
    localChangeUnsubscribe = null
  }
}

export function startDataSyncAutoSync(immediate = false) {
  const intervalMs = getAutoSyncIntervalMs()
  if (intervalMs === null) {
    stopDataSyncAutoSync()
    return
  }

  ensureLocalChangeAutoSyncSubscription()

  if (autoSyncStarted && syncTimeout && !immediate) {
    return
  }

  autoSyncStarted = true
  scheduleNextSync(immediate ? 1000 : intervalMs)
}

function scheduleNextSync(delayMs: number) {
  if (syncTimeout) {
    clearTimeout(syncTimeout)
  }

  syncTimeout = setTimeout(() => {
    void performAutoSync()
  }, delayMs)

  logger.info('Data sync scheduled', { delayMs })
}

async function performAutoSync() {
  const intervalMs = getAutoSyncIntervalMs()
  if (intervalMs === null) {
    stopDataSyncAutoSync()
    return
  }

  try {
    await syncAppDataNow()
  } catch (error) {
    logger.warn('Auto data sync failed', error as Error)
    void reportErrorToSystemAgent(error, {
      source: 'data-sync.auto',
      domain: 'dataSync'
    })
  } finally {
    if (autoSyncStarted) {
      const nextIntervalMs = getAutoSyncIntervalMs()
      if (nextIntervalMs === null) {
        stopDataSyncAutoSync()
      } else {
        scheduleNextSync(nextIntervalMs)
      }
    }
  }
}
