import { loggerService } from '@logger'
import { RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE } from '@shared/dataSyncBridge'

import { prepareStorageV2ForDataSync } from './StorageV2Service'

const logger = loggerService.withContext('StorageV2DataSyncBridge')

type StorageV2DataSyncBridgeWindow = Window & {
  [RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE]?: () => Promise<void>
}

export function registerStorageV2DataSyncBridge() {
  const bridgeWindow = window as StorageV2DataSyncBridgeWindow
  bridgeWindow[RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE] = async () => {
    logger.info('Preparing Storage v2 for data sync from main-process bridge')
    await prepareStorageV2ForDataSync()
  }
}
