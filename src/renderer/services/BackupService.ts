import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import db from '@renderer/databases'
import { upgradeToV7, upgradeToV8 } from '@renderer/databases/upgrades'
import i18n from '@renderer/i18n'
import store, { handleSaveData } from '@renderer/store'
import { setLocalBackupSyncState, setS3SyncState, setWebDAVSyncState } from '@renderer/store/backup'
import type { S3Config, WebDavConfig } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import dayjs from 'dayjs'

import { notificationService } from './NotificationService'
import { importLegacyDexieToStorageV2, suspendStorageV2RuntimeMirrorsUntilReload } from './StorageV2Service'

const logger = loggerService.withContext('BackupService')
const STORAGE_V2_AUTO_HYDRATE_SETTING_KEY = 'storage_v2.runtime.auto_hydrate'
const MANAGED_BACKUP_FILE_NAME_PATTERN = /^cherry-studio(?:-pi)?\.\d{12,14}(?:\..+)?\.zip$/

function isManagedBackupFileName(fileName: string) {
  return MANAGED_BACKUP_FILE_NAME_PATTERN.test(fileName)
}

function isCurrentDeviceManagedBackupFile(fileName: string, hostname: string, deviceType: string) {
  return isManagedBackupFileName(fileName) && fileName.endsWith(`.${hostname}.${deviceType}.zip`)
}

function backupModifiedTime(file: { modifiedTime?: string | null }) {
  const modifiedTime = Date.parse(file.modifiedTime || '')
  return Number.isFinite(modifiedTime) ? modifiedTime : 0
}

function sortBackupFilesNewestFirst<T extends { fileName: string; modifiedTime?: string | null }>(files: T[]) {
  return [...files].sort((a, b) => backupModifiedTime(b) - backupModifiedTime(a))
}

function getCachedPreference<K extends UnifiedPreferenceKeyType>(
  key: K,
  fallback: UnifiedPreferenceType[K]
): UnifiedPreferenceType[K] {
  const value = preferenceService.getCachedValue(key)
  return value === undefined ? fallback : value
}

function getWebdavBackupSettings() {
  const settings = store.getState().settings
  return {
    webdavAutoSync: getCachedPreference('data.backup.webdav.auto_sync', settings.webdavAutoSync),
    webdavDisableStream: getCachedPreference('data.backup.webdav.disable_stream', settings.webdavDisableStream),
    webdavHost: getCachedPreference('data.backup.webdav.host', settings.webdavHost),
    webdavMaxBackups: getCachedPreference('data.backup.webdav.max_backups', settings.webdavMaxBackups),
    webdavPass: getCachedPreference('data.backup.webdav.pass', settings.webdavPass),
    webdavPath: getCachedPreference('data.backup.webdav.path', settings.webdavPath),
    webdavSkipBackupFile: getCachedPreference('data.backup.webdav.skip_backup_file', settings.webdavSkipBackupFile),
    webdavSyncInterval: getCachedPreference('data.backup.webdav.sync_interval', settings.webdavSyncInterval),
    webdavUser: getCachedPreference('data.backup.webdav.user', settings.webdavUser)
  }
}

function getS3BackupSettings(): S3Config {
  const s3Settings = store.getState().settings.s3
  return {
    endpoint: getCachedPreference('data.backup.s3.endpoint', s3Settings?.endpoint ?? ''),
    region: getCachedPreference('data.backup.s3.region', s3Settings?.region ?? ''),
    bucket: getCachedPreference('data.backup.s3.bucket', s3Settings?.bucket ?? ''),
    accessKeyId: getCachedPreference('data.backup.s3.access_key_id', s3Settings?.accessKeyId ?? ''),
    secretAccessKey: getCachedPreference('data.backup.s3.secret_access_key', s3Settings?.secretAccessKey ?? ''),
    root: getCachedPreference('data.backup.s3.root', s3Settings?.root ?? ''),
    autoSync: getCachedPreference('data.backup.s3.auto_sync', s3Settings?.autoSync ?? false),
    syncInterval: getCachedPreference('data.backup.s3.sync_interval', s3Settings?.syncInterval ?? 0),
    maxBackups: getCachedPreference('data.backup.s3.max_backups', s3Settings?.maxBackups ?? 0),
    skipBackupFile: getCachedPreference('data.backup.s3.skip_backup_file', s3Settings?.skipBackupFile ?? false)
  }
}

function getLocalBackupSettings() {
  const settings = store.getState().settings
  return {
    localBackupAutoSync: getCachedPreference('data.backup.local.auto_sync', settings.localBackupAutoSync),
    localBackupDir: getCachedPreference('data.backup.local.dir', settings.localBackupDir),
    localBackupMaxBackups: getCachedPreference('data.backup.local.max_backups', settings.localBackupMaxBackups),
    localBackupSkipBackupFile: getCachedPreference(
      'data.backup.local.skip_backup_file',
      settings.localBackupSkipBackupFile
    ),
    localBackupSyncInterval: getCachedPreference('data.backup.local.sync_interval', settings.localBackupSyncInterval)
  }
}

async function disableStorageV2AutoHydrateAfterLegacyRestore() {
  try {
    await window.api.storageV2.setSetting(
      STORAGE_V2_AUTO_HYDRATE_SETTING_KEY,
      {
        enabled: false,
        reason: 'legacy-backup-restore',
        updatedAt: new Date().toISOString()
      },
      'storage-v2'
    )
  } catch (error) {
    logger.warn('Failed to disable Storage v2 auto hydrate after legacy restore', error as Error)
  }
}

async function mirrorRestoredLegacyDexieToStorageV2() {
  try {
    await importLegacyDexieToStorageV2({
      includeReduxOnlyTopics: false,
      preferMessageAssistantId: true,
      pruneMissing: true
    })
  } catch (error) {
    logger.warn('Failed to mirror restored legacy IndexedDB to Storage v2', error as Error)
  }
}

function requestRelaunchAfterRestore(source: string) {
  setTimeout(() => {
    try {
      void Promise.resolve(window.api.relaunchApp()).catch((error) => {
        logger.error(`${source}: Failed to relaunch app after data restore`, error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, i18n.t('common.operation_failed')))
      })
    } catch (error) {
      logger.error(`${source}: Failed to relaunch app after data restore`, error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, i18n.t('common.operation_failed')))
    }
  }, 1000)
}

// 重试删除S3文件的辅助函数
async function deleteS3FileWithRetry(fileName: string, s3Config: S3Config, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteS3File(fileName, s3Config)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

// 重试删除WebDAV文件的辅助函数
async function deleteWebdavFileWithRetry(fileName: string, webdavConfig: WebDavConfig, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteWebdavFile(fileName, webdavConfig)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

export async function backup(skipBackupFile: boolean) {
  const filename = `cherry-studio-pi.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    // Use direct backup method - copy IndexedDB/LocalStorage directories directly
    await handleSaveData()
    await window.api.backup.backup(filename, selectFolder, skipBackupFile)
    window.toast.success(i18n.t('message.backup.success'))
  }
}

export async function backupToLanTransfer() {
  // Let user select save location first
  const savePath = await window.api.file.selectFolder()

  if (!savePath) {
    return
  }

  // Create backup directly in the selected location
  const backupData = await getBackupData()
  await window.api.backup.createLanTransferBackup(backupData, savePath)

  window.toast.success(i18n.t('settings.data.export_to_phone.file.export_success'))
}

export async function restore() {
  try {
    const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }] })

    if (!file) {
      return
    }

    // zip backup file
    if (file.fileName.endsWith('.zip')) {
      const restoreData = await window.api.backup.restore(file.filePath)

      // Direct backup format returns void (app needs to relaunch)
      // Legacy format returns JSON string that needs to be processed
      if (restoreData !== undefined && restoreData !== null) {
        const data = JSON.parse(restoreData)
        await handleData(data)
      } else {
        // Direct backup was restored, app will relaunch
        void notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.restore.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
        // App will relaunch automatically
        return
      }
    } else {
      // Legacy .bak format
      const data = JSON.parse(await window.api.zip.decompress(file.content))
      await handleData(data)
    }

    void notificationService.send({
      id: uuid(),
      type: 'success',
      title: i18n.t('common.success'),
      message: i18n.t('message.restore.success'),
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
  } catch (error) {
    logger.error('restore: Error restoring backup file:', error as Error)
    window.modal.error({
      title: i18n.t('error.backup.file_format'),
      content: (error as Error).message,
      centered: true
    })
  }
}

export async function reset() {
  window.modal.confirm({
    title: i18n.t('common.warning'),
    content: i18n.t('message.reset.confirm.content'),
    centered: true,
    okButtonProps: {
      danger: true
    },
    onOk: async () => {
      window.modal.confirm({
        title: i18n.t('message.reset.double.confirm.title'),
        content: i18n.t('message.reset.double.confirm.content'),
        centered: true,
        onOk: async () => {
          try {
            await window.api.resetData()
            suspendStorageV2RuntimeMirrorsUntilReload()
            localStorage.clear()
            await clearDatabase()
            window.toast.success(i18n.t('message.reset.success'))
            requestRelaunchAfterRestore('reset')
          } catch (error) {
            logger.error('reset: Error resetting app data:', error as Error)
            window.toast.error(i18n.t('notes.settings.data.reset_failed'))
          }
        }
      })
    }
  })
}

// 备份到 webdav
/**
 * @param showMessage
 * @param customFileName
 * @param autoBackupProcess
 * if call in auto backup process, not show any message, any error will be thrown
 */
export async function backupToWebdav({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setWebDAVSyncState({ syncing: true, lastSyncError: null }))

  const {
    webdavHost,
    webdavUser,
    webdavPass,
    webdavPath,
    webdavMaxBackups,
    webdavSkipBackupFile,
    webdavDisableStream
  } = getWebdavBackupSettings()
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio-pi.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  // 上传文件 - Use direct backup method (copy IndexedDB/LocalStorage directories)
  try {
    await handleSaveData()

    const success = await window.api.backup.backupToWebdav({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: finalFileName,
      skipBackupFile: webdavSkipBackupFile,
      disableStream: webdavDisableStream
    })
    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )
      void notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (webdavMaxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listWebdavFiles({
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          })

          // 筛选当前设备的备份文件
          const currentDeviceFiles = sortBackupFilesNewestFirst(
            files.filter((file) => isCurrentDeviceManagedBackupFile(file.fileName, hostname, deviceType))
          )

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > webdavMaxBackups) {
            // 文件已按修改时间降序排序，所以最旧的文件在末尾
            const filesToDelete = currentDeviceFiles.slice(webdavMaxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            // 串行删除文件，避免并发请求导致的问题
            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteWebdavFileWithRetry(file.fileName, {
                webdavHost,
                webdavUser,
                webdavPass,
                webdavPath
              })

              // 在删除操作之间添加短暂延迟，避免请求过于频繁
              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      // if auto backup process, throw error
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setWebDAVSyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    // if auto backup process, throw error
    if (autoBackupProcess) {
      throw error
    }
    void notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    logger.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = getWebdavBackupSettings()
  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ webdavHost, webdavUser, webdavPass, webdavPath, fileName })
  } catch (error: any) {
    logger.error('[Backup] restoreFromWebdav: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
    return
  }

  // Direct backup format (version 6+) returns undefined - app needs to relaunch
  if (!data) {
    logger.info('[WebDAVBackup] Direct backup restored, app will restart')
    return
  }

  // Legacy backup format (version <= 5) returns JSON string
  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[Backup] Error downloading file from WebDAV:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
  }
}

export async function backupToS3({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setS3SyncState({ syncing: true, lastSyncError: null }))

  const s3Config = getS3BackupSettings()
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio-pi.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    // Use direct backup method (copy IndexedDB/LocalStorage directories)
    await handleSaveData()

    const success = await window.api.backup.backupToS3({
      ...s3Config,
      fileName: finalFileName
    })

    if (success) {
      store.dispatch(
        setS3SyncState({
          lastSyncError: null,
          syncing: false,
          lastSyncTime: Date.now()
        })
      )
      void notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (s3Config.maxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listS3Files(s3Config)

          // 筛选当前设备的备份文件
          const currentDeviceFiles = sortBackupFilesNewestFirst(
            files.filter((file) => isCurrentDeviceManagedBackupFile(file.fileName, hostname, deviceType))
          )

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > s3Config.maxBackups) {
            const filesToDelete = currentDeviceFiles.slice(s3Config.maxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteS3FileWithRetry(file.fileName, s3Config)

              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setS3SyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }
    void notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setS3SyncState({ lastSyncError: error.message }))
    logger.error('backupToS3: Error uploading file to S3:', error)
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setS3SyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  const s3Config = getS3BackupSettings()

  if (!fileName) {
    const files = await window.api.backup.listS3Files(s3Config)
    if (files.length > 0) {
      fileName = files[0].fileName
    }
  }

  if (fileName) {
    const restoreData = await window.api.backup.restoreFromS3({
      ...s3Config,
      fileName
    })

    // Direct backup format (version 6+) returns undefined - app needs to relaunch
    if (!restoreData) {
      logger.info('[S3Backup] Direct backup restored, app will restart')
      return
    }

    // Legacy backup format (version <= 5) returns JSON string
    const data = JSON.parse(restoreData)
    await handleData(data)
  }
}

let isManualBackupRunning = false

// 为每种备份类型维护独立的状态
let webdavAutoSyncStarted = false
let webdavSyncTimeout: NodeJS.Timeout | null = null
let isWebdavAutoBackupRunning = false

let s3AutoSyncStarted = false
let s3SyncTimeout: NodeJS.Timeout | null = null
let isS3AutoBackupRunning = false

let localAutoSyncStarted = false
let localSyncTimeout: NodeJS.Timeout | null = null
let isLocalAutoBackupRunning = false

type BackupType = 'webdav' | 's3' | 'local'

function isAutoSyncStarted(backupType: BackupType) {
  if (backupType === 'webdav') {
    return webdavAutoSyncStarted
  }
  if (backupType === 's3') {
    return s3AutoSyncStarted
  }
  return localAutoSyncStarted
}

function setAutoSyncStarted(backupType: BackupType, started: boolean) {
  if (backupType === 'webdav') {
    webdavAutoSyncStarted = started
  } else if (backupType === 's3') {
    s3AutoSyncStarted = started
  } else {
    localAutoSyncStarted = started
  }
}

function isAutoBackupRunning(backupType: BackupType) {
  if (backupType === 'webdav') {
    return isWebdavAutoBackupRunning
  }
  if (backupType === 's3') {
    return isS3AutoBackupRunning
  }
  return isLocalAutoBackupRunning
}

function setAutoBackupRunning(backupType: BackupType, running: boolean) {
  if (backupType === 'webdav') {
    isWebdavAutoBackupRunning = running
  } else if (backupType === 's3') {
    isS3AutoBackupRunning = running
  } else {
    isLocalAutoBackupRunning = running
  }
}

export function startAutoSync(immediate = false, type?: BackupType) {
  // 如果没有指定类型，启动所有配置的自动同步
  if (!type) {
    const webdavSettings = getWebdavBackupSettings()
    const s3Settings = getS3BackupSettings()
    const localSettings = getLocalBackupSettings()

    if (webdavSettings.webdavAutoSync && webdavSettings.webdavHost) {
      startAutoSync(immediate, 'webdav')
    }
    if (s3Settings.autoSync && s3Settings.endpoint) {
      startAutoSync(immediate, 's3')
    }
    if (localSettings.localBackupAutoSync && localSettings.localBackupDir) {
      startAutoSync(immediate, 'local')
    }
    return
  }

  // 根据类型启动特定的自动同步
  if (type === 'webdav') {
    const wasStarted = webdavAutoSyncStarted
    if (wasStarted) {
      logger.verbose('[WebdavAutoSync] Restarting auto sync')
    }

    const { webdavAutoSync, webdavHost } = getWebdavBackupSettings()

    if (!webdavAutoSync || !webdavHost) {
      logger.info('[WebdavAutoSync] Invalid sync settings, auto sync disabled')
      if (wasStarted) {
        stopAutoSync('webdav')
      }
      return
    }

    stopAutoSync('webdav')
    webdavAutoSyncStarted = true
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'webdav')
  } else if (type === 's3') {
    const wasStarted = s3AutoSyncStarted
    if (wasStarted) {
      logger.verbose('[S3AutoSync] Restarting auto sync')
    }

    const s3Settings = getS3BackupSettings()

    if (!s3Settings.autoSync || !s3Settings.endpoint) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      if (wasStarted) {
        stopAutoSync('s3')
      }
      return
    }

    stopAutoSync('s3')
    s3AutoSyncStarted = true
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 's3')
  } else if (type === 'local') {
    const wasStarted = localAutoSyncStarted
    if (wasStarted) {
      logger.verbose('[LocalAutoSync] Restarting auto sync')
    }

    const { localBackupAutoSync, localBackupDir } = getLocalBackupSettings()

    if (!localBackupAutoSync || !localBackupDir) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      if (wasStarted) {
        stopAutoSync('local')
      }
      return
    }

    stopAutoSync('local')
    localAutoSyncStarted = true
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'local')
  }

  function scheduleNextBackup(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow', backupType: BackupType) {
    let syncInterval: number
    let lastSyncTime: number | undefined
    let logPrefix: string

    // 根据备份类型获取相应的配置和状态
    const backup = store.getState().backup

    if (backupType === 'webdav') {
      if (webdavSyncTimeout) {
        clearTimeout(webdavSyncTimeout)
        webdavSyncTimeout = null
      }
      syncInterval = getWebdavBackupSettings().webdavSyncInterval
      lastSyncTime = backup.webdavSync?.lastSyncTime || undefined
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      if (s3SyncTimeout) {
        clearTimeout(s3SyncTimeout)
        s3SyncTimeout = null
      }
      syncInterval = getS3BackupSettings().syncInterval
      lastSyncTime = backup.s3Sync?.lastSyncTime || undefined
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      if (localSyncTimeout) {
        clearTimeout(localSyncTimeout)
        localSyncTimeout = null
      }
      syncInterval = getLocalBackupSettings().localBackupSyncInterval
      lastSyncTime = backup.localBackupSync?.lastSyncTime || undefined
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (!isAutoSyncStarted(backupType)) {
      logger.verbose(`${logPrefix} Auto sync stopped, skip scheduling`)
      return
    }

    if (!syncInterval || syncInterval <= 0) {
      logger.verbose(`${logPrefix} Invalid sync interval, auto sync disabled`)
      stopAutoSync(backupType)
      return
    }

    const requiredInterval = syncInterval * 60 * 1000
    let timeUntilNextSync = 1000

    switch (scheduleType) {
      case 'fromLastSyncTime':
        timeUntilNextSync = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    const timeout = setTimeout(() => performAutoBackup(backupType), timeUntilNextSync)

    // 保存对应类型的 timeout
    if (backupType === 'webdav') {
      webdavSyncTimeout = timeout
    } else if (backupType === 's3') {
      s3SyncTimeout = timeout
    } else if (backupType === 'local') {
      localSyncTimeout = timeout
    }

    logger.verbose(
      `${logPrefix} Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup(backupType: BackupType) {
    let logPrefix: string

    if (backupType === 'webdav') {
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (!isAutoSyncStarted(backupType)) {
      logger.verbose(`${logPrefix} Auto sync stopped, skip backup`)
      return
    }

    if (isAutoBackupRunning(backupType) || isManualBackupRunning) {
      logger.verbose(`${logPrefix} Backup already in progress, rescheduling`)
      scheduleNextBackup('fromNow', backupType)
      return
    }

    // Check if any topic is currently streaming/loading
    const state = store.getState()
    const anyTopicLoading = Object.values(state.messages.loadingByTopic).some((loading) => loading === true)

    if (anyTopicLoading) {
      logger.info(`${logPrefix} Streaming in progress, deferring backup`)
      scheduleNextBackup('fromNow', backupType)
      return
    }

    setAutoBackupRunning(backupType, true)

    const maxRetries = 4
    let retryCount = 0

    try {
      while (retryCount < maxRetries && isAutoSyncStarted(backupType)) {
        try {
          logger.verbose(`${logPrefix} Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)

          if (backupType === 'webdav') {
            await backupToWebdav({ autoBackupProcess: true })
            store.dispatch(
              setWebDAVSyncState({
                lastSyncError: null,
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          } else if (backupType === 's3') {
            await backupToS3({ autoBackupProcess: true })
            store.dispatch(
              setS3SyncState({
                lastSyncError: null,
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          } else if (backupType === 'local') {
            await backupToLocal({ autoBackupProcess: true })
            store.dispatch(
              setLocalBackupSyncState({
                lastSyncError: null,
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          }

          scheduleNextBackup('fromNow', backupType)
          break
        } catch (error: any) {
          retryCount++
          if (retryCount === maxRetries) {
            logger.error(`${logPrefix} Auto backup failed after all retries:`, error)

            if (backupType === 'webdav') {
              store.dispatch(
                setWebDAVSyncState({
                  lastSyncError: 'Auto backup failed',
                  lastSyncTime: Date.now(),
                  syncing: false
                })
              )
            } else if (backupType === 's3') {
              store.dispatch(
                setS3SyncState({
                  lastSyncError: 'Auto backup failed',
                  lastSyncTime: Date.now(),
                  syncing: false
                })
              )
            } else if (backupType === 'local') {
              store.dispatch(
                setLocalBackupSyncState({
                  lastSyncError: 'Auto backup failed',
                  lastSyncTime: Date.now(),
                  syncing: false
                })
              )
            }

            await window.modal.error({
              title: i18n.t('message.backup.failed'),
              content: `${logPrefix} ${new Date().toLocaleString()} ` + error.message
            })

            scheduleNextBackup('fromNow', backupType)
          } else {
            const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
            logger.warn(`${logPrefix} Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

            await new Promise((resolve) => setTimeout(resolve, backoffDelay))

            if (!isAutoSyncStarted(backupType)) {
              logger.info(`${logPrefix} retry cancelled by user, exit`)
              break
            }
          }
        }
      }
    } finally {
      setAutoBackupRunning(backupType, false)
    }
  }
}

export function stopAutoSync(type?: BackupType) {
  // 如果没有指定类型，停止所有自动同步
  if (!type) {
    stopAutoSync('webdav')
    stopAutoSync('s3')
    stopAutoSync('local')
    return
  }

  if (type === 'webdav') {
    if (webdavSyncTimeout) {
      logger.info('[WebdavAutoSync] Stopping auto sync')
      clearTimeout(webdavSyncTimeout)
      webdavSyncTimeout = null
    }
    setAutoSyncStarted('webdav', false)
  } else if (type === 's3') {
    if (s3SyncTimeout) {
      logger.info('[S3AutoSync] Stopping auto sync')
      clearTimeout(s3SyncTimeout)
      s3SyncTimeout = null
    }
    setAutoSyncStarted('s3', false)
  } else if (type === 'local') {
    if (localSyncTimeout) {
      logger.info('[LocalAutoSync] Stopping auto sync')
      clearTimeout(localSyncTimeout)
      localSyncTimeout = null
    }
    setAutoSyncStarted('local', false)
  }
}

export async function getBackupData() {
  await handleSaveData()

  return JSON.stringify({
    time: new Date().getTime(),
    version: 5,
    localStorage,
    indexedDB: await backupDatabase()
  })
}

/************************************* Backup Utils ************************************** */
export async function handleData(data: Record<string, any>) {
  if (data.version === 1) {
    suspendStorageV2RuntimeMirrorsUntilReload()
    await clearDatabase()

    for (const { key, value } of data.indexedDB) {
      if (key.startsWith('topic:')) {
        await db.table('topics').add({ id: value.id, messages: value.messages })
      }
      if (key === 'image://avatar') {
        await db.table('settings').add({ id: key, value })
      }
    }

    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    await mirrorRestoredLegacyDexieToStorageV2()
    await disableStorageV2AutoHydrateAfterLegacyRestore()
    window.toast.success(i18n.t('message.restore.success'))
    requestRelaunchAfterRestore('handleData:v1')
    return
  }

  if (data.version >= 2) {
    suspendStorageV2RuntimeMirrorsUntilReload()
    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])

    // remove notes_tree from indexedDB
    if (data.indexedDB['notes_tree']) {
      delete data.indexedDB['notes_tree']
    }

    await restoreDatabase(data.indexedDB)

    if (data.version === 3) {
      await db.transaction('rw', db.tables, async (tx) => {
        await db.table('message_blocks').clear()
        await upgradeToV7(tx)
      })
    }

    if (data.version === 4) {
      await db.transaction('rw', db.tables, async (tx) => {
        await upgradeToV8(tx)
      })
    }

    await mirrorRestoredLegacyDexieToStorageV2()
    await disableStorageV2AutoHydrateAfterLegacyRestore()
    window.toast.success(i18n.t('message.restore.success'))
    requestRelaunchAfterRestore(`handleData:v${data.version}`)
    return
  }

  window.toast.error(i18n.t('error.backup.file_format'))
}

async function backupDatabase() {
  const tables = db.tables
  const backup = {}

  for (const table of tables) {
    backup[table.name] = await table.toArray()
  }

  return backup
}

async function restoreDatabase(backup: Record<string, any>) {
  const tableNames = new Set(db.tables.map((table) => table.name))

  await db.transaction('rw', db.tables, async () => {
    for (const tableName of tableNames) {
      await db.table(tableName).clear()
    }

    for (const tableName in backup) {
      if (!tableNames.has(tableName)) {
        logger.warn(`Skipping unknown IndexedDB backup table: ${tableName}`)
        continue
      }

      await db.table(tableName).bulkAdd(backup[tableName])
    }
  })
}

async function clearDatabase() {
  const storeNames = db.tables.map((table) => table.name)

  await db.transaction('rw', db.tables, async () => {
    for (const storeName of storeNames) {
      await db[storeName].clear()
    }
  })
}

/**
 * Backup to local directory
 */
export async function backupToLocal({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setLocalBackupSyncState({ syncing: true, lastSyncError: null }))

  const {
    localBackupDir: localBackupDirSetting,
    localBackupMaxBackups,
    localBackupSkipBackupFile
  } = getLocalBackupSettings()
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio-pi.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  try {
    // Use direct backup method (copy IndexedDB/LocalStorage directories)
    await handleSaveData()

    const result = await window.api.backup.backupToLocalDir(finalFileName, {
      localBackupDir,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: null
        })
      )

      if (showMessage) {
        void notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }

      // Clean up old backups if maxBackups is set
      if (localBackupMaxBackups > 0) {
        try {
          // Get all backup files
          const files = await window.api.backup.listLocalBackupFiles(localBackupDir)

          // Filter backups for current device
          const currentDeviceFiles = sortBackupFilesNewestFirst(
            files.filter((file) => isCurrentDeviceManagedBackupFile(file.fileName, hostname, deviceType))
          )

          if (currentDeviceFiles.length > localBackupMaxBackups) {
            const filesToDelete = currentDeviceFiles.slice(localBackupMaxBackups)

            // Delete older backups
            for (const file of filesToDelete) {
              logger.verbose(`[LocalBackup] Deleting old backup: ${file.fileName}`)
              await window.api.backup.deleteLocalBackupFile(file.fileName, localBackupDir)
            }
          }
        } catch (error) {
          logger.error('[LocalBackup] Failed to clean up old backups:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: 'Backup failed'
        })
      )

      if (showMessage) {
        window.modal.error({
          title: i18n.t('message.backup.failed'),
          content: 'Backup failed'
        })
      }
    }

    return result
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }

    logger.error('[LocalBackup] Backup failed:', error)

    store.dispatch(
      setLocalBackupSyncState({
        lastSyncError: error.message || 'Unknown error'
      })
    )

    if (showMessage) {
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message || 'Unknown error'
      })
    }

    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromLocal(fileName: string) {
  try {
    const { localBackupDir: localBackupDirSetting } = getLocalBackupSettings()
    const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
    const restoreData = await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)

    // Direct backup format (version 6+) returns undefined - app needs to relaunch
    if (!restoreData) {
      logger.info('[LocalBackup] Direct backup restored, app will restart')
      return true
    }

    // Legacy backup format (version <= 5) returns JSON string
    const data = JSON.parse(restoreData)
    await handleData(data)

    return true
  } catch (error) {
    logger.error('[LocalBackup] Restore failed:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
    throw error
  }
}
