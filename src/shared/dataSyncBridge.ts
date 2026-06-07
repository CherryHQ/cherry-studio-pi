export const RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE = '__CHERRY_STUDIO_PI_PREPARE_STORAGE_V2_FOR_DATA_SYNC__'
export const RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE = '__CHERRY_STUDIO_PI_GET_DATA_SYNC_SETTINGS__'
export const RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE = '__CHERRY_STUDIO_PI_SET_DATA_SYNC_SETTINGS__'

export type DataSyncBridgeSettings = {
  dataSyncWebdavHost: string
  dataSyncWebdavUser: string
  dataSyncWebdavPass: string
  dataSyncWebdavPath: string
  dataSyncAutoSync: boolean
  dataSyncSyncInterval: number
}

export type DataSyncBridgeSettingsUpdate = Partial<DataSyncBridgeSettings>
