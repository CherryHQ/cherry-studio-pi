import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store, { handleSaveData } from '@renderer/store'
import { setNutstoreSyncState } from '@renderer/store/nutstore'
import type { WebDavConfig } from '@renderer/types'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import type { UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import { handleData } from './BackupService'

const logger = loggerService.withContext('NutstoreService')
const MANAGED_BACKUP_FILE_NAME_PATTERN = /^cherry-studio(?:-pi)?\.\d{12,14}(?:\..+)?\.zip$/

function isManagedBackupFileName(fileName: string) {
  return MANAGED_BACKUP_FILE_NAME_PATTERN.test(fileName)
}

function backupModifiedTime(file: { modifiedTime?: string | null }) {
  const modifiedTime = Date.parse(file.modifiedTime || '')
  return Number.isFinite(modifiedTime) ? modifiedTime : 0
}

function getCachedPreference<K extends UnifiedPreferenceKeyType>(
  key: K,
  fallback: UnifiedPreferenceType[K]
): UnifiedPreferenceType[K] {
  const value = preferenceService.getCachedValue(key)
  return value === undefined ? fallback : value
}

function getNutstoreSettings() {
  const nutstore = store.getState().nutstore
  return {
    nutstoreAutoSync: getCachedPreference('data.backup.nutstore.auto_sync', nutstore.nutstoreAutoSync),
    nutstoreMaxBackups: getCachedPreference('data.backup.nutstore.max_backups', nutstore.nutstoreMaxBackups),
    nutstorePath: getCachedPreference('data.backup.nutstore.path', nutstore.nutstorePath),
    nutstoreSkipBackupFile: getCachedPreference(
      'data.backup.nutstore.skip_backup_file',
      nutstore.nutstoreSkipBackupFile
    ),
    nutstoreSyncInterval: getCachedPreference('data.backup.nutstore.sync_interval', nutstore.nutstoreSyncInterval),
    nutstoreSyncState: nutstore.nutstoreSyncState,
    nutstoreToken: getCachedPreference('data.backup.nutstore.token', nutstore.nutstoreToken ?? '')
  }
}

export const getNutstoreSyncState = () => store.getState().nutstore.nutstoreSyncState

function getNutstoreToken() {
  const { nutstoreToken } = getNutstoreSettings()

  if (!nutstoreToken) {
    window.toast?.error(i18n.t('message.error.invalid.nutstore_token'))
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!result) {
    logger.warn('Invalid nutstore token')
    return null
  }

  const { nutstorePath } = getNutstoreSettings()

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

export async function checkConnection() {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return false
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return false
  }

  const isSuccess = await window.api.backup.checkWebdavConnection({
    ...config,
    webdavPath: '/'
  })

  return isSuccess
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false
let isManualBackupRunning = false

async function cleanupOldBackups(webdavConfig: WebDavConfig, maxBackups: number): Promise<void> {
  if (maxBackups <= 0) {
    logger.debug('[cleanupOldBackups] Skip cleanup: maxBackups <= 0')
    return
  }

  try {
    const files = await window.api.backup.listWebdavFiles(webdavConfig)

    if (!files || !Array.isArray(files)) {
      logger.warn('[cleanupOldBackups] Failed to list nutstore directory contents')
      return
    }

    const backupFiles = files
      .filter((file) => isManagedBackupFileName(file.fileName))
      .sort((a, b) => backupModifiedTime(b) - backupModifiedTime(a))

    if (backupFiles.length < maxBackups) {
      logger.info(`[cleanupOldBackups] No cleanup needed: ${backupFiles.length}/${maxBackups} backups`)
      return
    }

    const filesToDelete = backupFiles.slice(maxBackups - 1)
    logger.info(`[cleanupOldBackups] Deleting ${filesToDelete.length} old backup files`)

    let deletedCount = 0
    for (const file of filesToDelete) {
      try {
        await window.api.backup.deleteWebdavFile(file.fileName, webdavConfig)
        deletedCount++
      } catch (error) {
        logger.error(`[cleanupOldBackups] Failed to delete ${file.basename}:`, error as Error)
      }
    }

    if (deletedCount > 0) {
      logger.info(`[cleanupOldBackups] Successfully deleted ${deletedCount} old backups`)
    }
  } catch (error) {
    logger.error('[cleanupOldBackups] Error during cleanup:', error as Error)
  }
}

export async function backupToNutstore({
  showMessage = false,
  customFileName = ''
}: {
  showMessage?: boolean
  customFileName?: string
} = {}) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let deviceType = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
  } catch (error) {
    logger.error('[backupToNutstore] Failed to get device type:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio-pi.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

  const { nutstoreMaxBackups, nutstoreSkipBackupFile } = getNutstoreSettings()

  try {
    await handleSaveData()

    // 先清理旧备份
    await cleanupOldBackups(config, nutstoreMaxBackups)

    const isSuccess = await window.api.backup.backupToWebdav({
      ...config,
      fileName: finalFileName,
      skipBackupFile: nutstoreSkipBackupFile
    })

    if (isSuccess) {
      store.dispatch(setNutstoreSyncState({ lastSyncError: null }))
      showMessage && window.toast?.success(i18n.t('message.backup.success'))
    } else {
      store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
      window.toast?.error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    store.dispatch(setNutstoreSyncState({ lastSyncError: errorMessage }))
    logger.error('[Nutstore] Backup failed:', error as Error)
    window.toast?.error(formatErrorMessageWithPrefix(error, i18n.t('message.backup.failed')))
  } finally {
    store.dispatch(setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false }))
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ ...config, fileName })
  } catch (error) {
    logger.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: getErrorMessage(error)
    })
    return
  }

  if (!data) {
    logger.info('[Nutstore] Direct backup restored, app will restart')
    return
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[backup] Error downloading file from WebDAV:', error as Error)
    window.toast?.error(i18n.t('error.backup.file_format'))
  }
}

export async function startNutstoreAutoSync() {
  const wasStarted = autoSyncStarted
  if (autoSyncStarted) {
    logger.verbose('[Nutstore AutoSync] Restarting nutstore auto sync')
  }

  const nutstoreToken = await getNutstoreToken()

  if (!nutstoreToken) {
    logger.warn('[startNutstoreAutoSync] Invalid nutstore token, nutstore auto sync disabled')
    if (wasStarted) {
      stopNutstoreAutoSync()
    }
    return
  }

  stopNutstoreAutoSync()
  autoSyncStarted = true

  await scheduleNextBackup()

  function scheduleNextBackup() {
    if (!autoSyncStarted) {
      return
    }

    if (syncTimeout) {
      clearTimeout(syncTimeout)
      syncTimeout = null
    }

    const { nutstoreSyncInterval, nutstoreSyncState } = getNutstoreSettings()

    if (nutstoreSyncInterval <= 0) {
      logger.warn('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
      stopNutstoreAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = nutstoreSyncInterval * 60 * 1000

    // 如果存在最后一次同步WebDAV的时间，以它为参考计算下一次同步的时间
    const timeUntilNextSync = nutstoreSyncState.lastSyncTime
      ? Math.max(1000, nutstoreSyncState.lastSyncTime + requiredInterval - Date.now())
      : requiredInterval

    syncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    logger.verbose(
      `[Nutstore AutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (!autoSyncStarted) {
      return
    }

    if (isAutoBackupRunning || isManualBackupRunning) {
      logger.verbose('[Nutstore AutoSync] Backup already in progress, rescheduling')
      await scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    try {
      logger.verbose('[Nutstore AutoSync] Starting auto backup...')
      await backupToNutstore({ showMessage: false })
    } catch (error) {
      logger.error('[Nutstore AutoSync] Auto backup failed:', error as Error)
    } finally {
      isAutoBackupRunning = false
      if (autoSyncStarted) {
        scheduleNextBackup()
      }
    }
  }
}

export function stopNutstoreAutoSync() {
  if (syncTimeout) {
    logger.verbose('[Nutstore AutoSync] Stopping nutstore auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  autoSyncStarted = false
}

export async function createDirectory(path: string, options?: CreateDirectoryOptions) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}
