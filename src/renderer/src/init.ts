import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import { startAutoSync } from './services/BackupService'
import { startDataSyncAutoSync, startDataSyncExternalSyncListener } from './services/DataSyncService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import { prepareStorageV2ForDataSync } from './services/StorageV2Service'
import storeSyncService from './services/StoreSyncService'
import { initSystemAgentErrorTriggers } from './services/SystemAgentService'
import { webTraceService } from './services/WebTraceService'
import store from './store'

loggerService.initWindowSource('mainWindow')

function initKeyv() {
  window.keyv = new KeyvStorage()
  void window.keyv.init()
}

function initAutoSync() {
  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync, dataSyncAutoSync, s3 } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
      startAutoSync()
    }
    if (nutstoreAutoSync) {
      void startNutstoreAutoSync()
    }
    if (dataSyncAutoSync) {
      startDataSyncAutoSync(true)
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

function initSystemAgent() {
  initSystemAgentErrorTriggers()
}

function initStorageV2RuntimeBridge() {
  window.storageV2Runtime = {
    prepareForDataSync: prepareStorageV2ForDataSync
  }
}

function initDataSyncExternalEvents() {
  startDataSyncExternalSyncListener()
}

initKeyv()
initStorageV2RuntimeBridge()
initSystemAgent()
initDataSyncExternalEvents()
initAutoSync()
initStoreSync()
initWebTrace()
