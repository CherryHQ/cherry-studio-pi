import { loggerService } from '@logger'
import store from '@renderer/store'
import {
  setDataSyncAutoSync,
  setDataSyncSyncInterval,
  setDataSyncWebdavHost,
  setDataSyncWebdavPass,
  setDataSyncWebdavPath,
  setDataSyncWebdavUser
} from '@renderer/store/settings'
import {
  type DataSyncBridgeSettings,
  type DataSyncBridgeSettingsUpdate,
  RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE,
  RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
  RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE
} from '@shared/dataSyncBridge'

import { prepareStorageV2ForDataSync } from './StorageV2Service'

const logger = loggerService.withContext('StorageV2DataSyncBridge')

type StorageV2DataSyncBridgeWindow = Window & {
  [RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE]?: () => Promise<void>
  [RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE]?: () => DataSyncBridgeSettings
  [RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE]?: (settings: DataSyncBridgeSettingsUpdate) => DataSyncBridgeSettings
}

function readDataSyncSettings(): DataSyncBridgeSettings {
  const settings = store.getState().settings
  return {
    dataSyncWebdavHost: settings.dataSyncWebdavHost,
    dataSyncWebdavUser: settings.dataSyncWebdavUser,
    dataSyncWebdavPass: settings.dataSyncWebdavPass,
    dataSyncWebdavPath: settings.dataSyncWebdavPath,
    dataSyncAutoSync: settings.dataSyncAutoSync,
    dataSyncSyncInterval: settings.dataSyncSyncInterval
  }
}

export function registerStorageV2DataSyncBridge() {
  const bridgeWindow = window as StorageV2DataSyncBridgeWindow
  bridgeWindow[RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE] = async () => {
    logger.info('Preparing Storage v2 for data sync from main-process bridge')
    await prepareStorageV2ForDataSync()
  }
  bridgeWindow[RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE] = () => readDataSyncSettings()
  bridgeWindow[RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE] = (settings) => {
    if (typeof settings.dataSyncWebdavHost === 'string') {
      store.dispatch(setDataSyncWebdavHost(settings.dataSyncWebdavHost))
    }
    if (typeof settings.dataSyncWebdavUser === 'string') {
      store.dispatch(setDataSyncWebdavUser(settings.dataSyncWebdavUser))
    }
    if (typeof settings.dataSyncWebdavPass === 'string') {
      store.dispatch(setDataSyncWebdavPass(settings.dataSyncWebdavPass))
    }
    if (typeof settings.dataSyncWebdavPath === 'string') {
      store.dispatch(setDataSyncWebdavPath(settings.dataSyncWebdavPath))
    }
    if (typeof settings.dataSyncAutoSync === 'boolean') {
      store.dispatch(setDataSyncAutoSync(settings.dataSyncAutoSync))
    }
    if (typeof settings.dataSyncSyncInterval === 'number' && Number.isFinite(settings.dataSyncSyncInterval)) {
      store.dispatch(setDataSyncSyncInterval(settings.dataSyncSyncInterval))
    }
    return readDataSyncSettings()
  }
}
