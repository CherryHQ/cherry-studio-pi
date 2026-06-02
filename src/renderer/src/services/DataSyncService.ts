import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import type { WebDavConfig } from '@renderer/types'

import { hydrateRuntimeCacheFromStorageV2 } from './StorageV2HydrationService'
import { prepareStorageV2ForDataSync } from './StorageV2Service'
import { reportErrorToSystemAgent } from './SystemAgentService'

const logger = loggerService.withContext('DataSyncService')

export type DataSyncSummary = {
  status?: 'success' | 'failed'
  error?: string | null
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  skipped: number
  storageUploaded?: number
  storageDownloaded?: number
  storageDeleted?: number
  storageConflicts?: number
  storageSkipped?: number
  blobUploaded?: number
  blobDownloaded?: number
  snapshotUploaded?: boolean
  snapshotFileName?: string | null
  snapshotBytes?: number
  remotePath?: string | null
  lastSyncAt: number
}

let syncTimeout: NodeJS.Timeout | null = null
let autoSyncStarted = false
let syncing = false

function hasDownloadedRemoteData(summary?: Partial<DataSyncSummary> | null) {
  if (!summary) return false

  return (
    (summary.downloaded ?? 0) > 0 ||
    (summary.storageDownloaded ?? 0) > 0 ||
    (summary.blobDownloaded ?? 0) > 0 ||
    (summary.deleted ?? 0) > 0 ||
    (summary.storageDeleted ?? 0) > 0
  )
}

async function hydrateRuntimeCacheAfterDataSync(context: string) {
  await hydrateRuntimeCacheFromStorageV2({
    dispatch: store.dispatch,
    flush: () => persistor.flush()
  }).catch((error) => {
    logger.warn(`Failed to hydrate runtime cache ${context}`, error as Error)
  })
}

async function hydratePreviouslyDownloadedRemoteData() {
  const status = await window.api.dataSync.getStatus().catch((error) => {
    logger.warn('Failed to inspect previous data sync status before sync', error as Error)
    return null
  })

  if (!hasDownloadedRemoteData(status?.lastSummary)) return

  await hydrateRuntimeCacheAfterDataSync('before data sync')
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

export async function syncAppDataNow(configOverride?: WebDavConfig): Promise<DataSyncSummary | null> {
  if (syncing) {
    logger.info('Data sync already running')
    return null
  }

  const config = configOverride ?? getWebDavConfig()
  if (!config.webdavHost) {
    throw new Error('WebDAV host is required')
  }

  syncing = true
  try {
    await hydratePreviouslyDownloadedRemoteData()
    await prepareStorageV2ForDataSync()
    const summary = await window.api.dataSync.syncNow(config)
    await hydrateRuntimeCacheAfterDataSync('after data sync')
    return summary
  } finally {
    syncing = false
  }
}

export function stopDataSyncAutoSync() {
  autoSyncStarted = false
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
}

export function startDataSyncAutoSync(immediate = false) {
  const settings = store.getState().settings
  if (!settings.dataSyncAutoSync || !settings.dataSyncWebdavHost || settings.dataSyncSyncInterval <= 0) {
    stopDataSyncAutoSync()
    return
  }

  if (autoSyncStarted && syncTimeout) {
    return
  }

  autoSyncStarted = true
  scheduleNextSync(immediate ? 1000 : settings.dataSyncSyncInterval * 60 * 1000)
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
  const settings = store.getState().settings
  if (!settings.dataSyncAutoSync || !settings.dataSyncWebdavHost || settings.dataSyncSyncInterval <= 0) {
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
      scheduleNextSync(store.getState().settings.dataSyncSyncInterval * 60 * 1000)
    }
  }
}
