import { loggerService } from '@logger'
import { storageV2AppDataKvMirrorService } from '@main/services/storageV2/AppDataKvMirrorService'
import { storageV2AppDataRuntimeRecoveryService } from '@main/services/storageV2/AppDataRuntimeRecoveryService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import { describeWebDavUserFacingError } from '@main/services/WebDavRetry'
import { IpcChannel } from '@shared/IpcChannel'
import type { WebDavConfig } from '@shared/types/backup'
import { normalizeWebDavConfig, normalizeWebDavPath } from '@shared/webdavConfig'
import { ipcMain } from 'electron'

import { createWorkbenchShortcutRecord, getAppDataDatabase } from './AppDataDatabase'
import {
  filterAppDataRecords,
  filterWorkbenchShortcuts,
  mergeAppDataRecords,
  mergeWorkbenchShortcuts
} from './AppDataRecordMerge'
import { appDataSyncService } from './AppDataSyncService'

const logger = loggerService.withContext('AppDataIpcService')
const DEFAULT_DATA_SYNC_PATH = '/cherry-studio-pi'

type DataSyncConfig = {
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
  autoSync: boolean
  syncInterval: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function ownValue(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function normalizeStoredString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeStoredBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStoredNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeOptionalStringInput(
  value: unknown,
  fallback: string,
  label: string,
  options: { trim?: boolean } = {}
) {
  if (value === undefined) return fallback
  if (value === null) return ''
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串。`)
  }
  return options.trim === false ? value : value.trim()
}

function normalizeOptionalBooleanInput(value: unknown, fallback: boolean, label: string) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  throw new Error(`${label} 必须是布尔值。`)
}

function normalizeOptionalSyncIntervalInput(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) {
    throw new Error('同步间隔必须是有限数字。')
  }
  return Math.max(0, Math.trunc(parsed))
}

async function resolveStoredSecret(value: unknown) {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''

  const secretRef = value.secretRef
  if (typeof secretRef !== 'string' || !secretRef) return ''

  return (await storageV2SecretVaultService.getSecret(secretRef)) ?? ''
}

async function readDataSyncConfig(): Promise<DataSyncConfig> {
  const [webdavHost, webdavUser, webdavPass, webdavPath, autoSync, syncInterval] = await Promise.all([
    storageV2Service.getSetting('settings.dataSyncWebdavHost'),
    storageV2Service.getSetting('settings.dataSyncWebdavUser'),
    storageV2Service.getSetting('settings.dataSyncWebdavPass'),
    storageV2Service.getSetting('settings.dataSyncWebdavPath'),
    storageV2Service.getSetting('settings.dataSyncAutoSync'),
    storageV2Service.getSetting('settings.dataSyncSyncInterval')
  ])

  return {
    webdavHost: normalizeStoredString(webdavHost),
    webdavUser: normalizeStoredString(webdavUser),
    webdavPass: await resolveStoredSecret(webdavPass),
    webdavPath: normalizeWebDavPath(normalizeStoredString(webdavPath, DEFAULT_DATA_SYNC_PATH), DEFAULT_DATA_SYNC_PATH),
    autoSync: normalizeStoredBoolean(autoSync),
    syncInterval: normalizeStoredNumber(syncInterval)
  }
}

async function writeDataSyncConfig(input: unknown): Promise<DataSyncConfig> {
  if (!isRecord(input)) {
    throw new Error('数据同步配置必须是对象。')
  }

  const current = await readDataSyncConfig()
  const candidate: DataSyncConfig = {
    webdavHost: normalizeOptionalStringInput(ownValue(input, 'webdavHost'), current.webdavHost, 'WebDAV URL'),
    webdavUser: normalizeOptionalStringInput(ownValue(input, 'webdavUser'), current.webdavUser, 'WebDAV 用户名'),
    webdavPass: normalizeOptionalStringInput(ownValue(input, 'webdavPass'), current.webdavPass, 'WebDAV 密码', {
      trim: false
    }),
    webdavPath: normalizeOptionalStringInput(
      ownValue(input, 'webdavPath'),
      current.webdavPath || DEFAULT_DATA_SYNC_PATH,
      'WebDAV 同步目录'
    ),
    autoSync: normalizeOptionalBooleanInput(ownValue(input, 'autoSync'), current.autoSync, '自动同步'),
    syncInterval: normalizeOptionalSyncIntervalInput(ownValue(input, 'syncInterval'), current.syncInterval)
  }

  const normalizedWebDavConfig = candidate.webdavHost.trim()
    ? normalizeWebDavConfig(
        {
          webdavHost: candidate.webdavHost,
          webdavUser: candidate.webdavUser,
          webdavPass: candidate.webdavPass,
          webdavPath: candidate.webdavPath
        },
        { defaultPath: DEFAULT_DATA_SYNC_PATH, requireCredentials: false }
      )
    : {
        webdavHost: '',
        webdavUser: candidate.webdavUser.trim(),
        webdavPass: candidate.webdavPass,
        webdavPath: normalizeWebDavPath(candidate.webdavPath, DEFAULT_DATA_SYNC_PATH)
      }

  const passwordSettingValue = normalizedWebDavConfig.webdavPass
    ? {
        secretRef: await storageV2SecretVaultService.setSecret(
          'settings',
          'dataSyncWebdavPass',
          'dataSyncWebdavPassword',
          normalizedWebDavConfig.webdavPass
        )
      }
    : ''

  await Promise.all([
    storageV2Service.setSetting('settings.dataSyncWebdavHost', normalizedWebDavConfig.webdavHost, 'settings'),
    storageV2Service.setSetting('settings.dataSyncWebdavUser', normalizedWebDavConfig.webdavUser, 'settings'),
    storageV2Service.setSetting('settings.dataSyncWebdavPass', passwordSettingValue, 'settings'),
    storageV2Service.setSetting(
      'settings.dataSyncWebdavPath',
      normalizedWebDavConfig.webdavPath || DEFAULT_DATA_SYNC_PATH,
      'settings'
    ),
    storageV2Service.setSetting('settings.dataSyncAutoSync', candidate.autoSync, 'settings'),
    storageV2Service.setSetting('settings.dataSyncSyncInterval', candidate.syncInterval, 'settings')
  ])

  return {
    webdavHost: normalizedWebDavConfig.webdavHost,
    webdavUser: normalizedWebDavConfig.webdavUser,
    webdavPass: normalizedWebDavConfig.webdavPass,
    webdavPath: normalizedWebDavConfig.webdavPath || DEFAULT_DATA_SYNC_PATH,
    autoSync: candidate.autoSync,
    syncInterval: candidate.syncInterval
  }
}

function getDataSyncUserErrorMessage(error: unknown, action: string) {
  const message = describeWebDavUserFacingError(error, action)
  logger.warn(message, error as Error)
  return message
}

function throwDataSyncUserError(error: unknown, action: string): never {
  const message = getDataSyncUserErrorMessage(error, action)
  throw new Error(message)
}

function isDataSyncAlreadyRunningMessage(message: string) {
  return /Data sync is already running|已有数据同步正在进行|同步正在进行/i.test(message)
}

async function rememberDataSyncFailure(message: string, options: { preserveLastSummary?: boolean } = {}) {
  await Promise.resolve(appDataSyncService.recordSyncFailure(new Error(message), options)).catch((recordError) => {
    logger.warn('Failed to record data sync failure summary', recordError as Error)
  })
}

export function registerAppDataIpcHandlers() {
  ipcMain.handle(IpcChannel.AppData_Get, async (_, scope: string, key: string) => {
    const db = await getAppDataDatabase()
    const entry = await db.getRecordEntry(scope, key)
    if (entry.found) {
      return entry.value
    }

    const storageEntry = await storageV2AppDataKvMirrorService.getRecordEntry(scope, key)
    if (storageEntry.found) {
      return storageEntry.value
    }

    if (await storageV2AppDataRuntimeRecoveryService.projectIfAppRecordMissing(scope, key, 'app-data-get-missing')) {
      const recoveredEntry = await db.getRecordEntry(scope, key)
      return recoveredEntry.found ? recoveredEntry.value : null
    }

    return null
  })

  ipcMain.handle(IpcChannel.AppData_Set, async (_, scope: string, key: string, value: unknown) => {
    const db = await getAppDataDatabase()
    const updatedAt = Date.now()
    await storageV2AppDataKvMirrorService.upsertRecord(scope, key, value, updatedAt)
    const record = await db.setRecord(scope, key, value, updatedAt, undefined, { storageV2Mirrored: true })
    return record
  })

  ipcMain.handle(IpcChannel.AppData_Delete, async (_, scope: string, key: string) => {
    const db = await getAppDataDatabase()
    const deletedAt = Date.now()
    await storageV2AppDataKvMirrorService.deleteRecord(scope, key, deletedAt)
    await db.deleteRecord(scope, key, deletedAt, { storageV2Mirrored: true })
  })

  ipcMain.handle(IpcChannel.AppData_List, async (_, scope?: string, includeDeleted?: boolean) => {
    let db = await getAppDataDatabase()
    const records = await db.listRecords(scope, includeDeleted)
    const legacyRecords = includeDeleted ? records : await db.listRecords(scope, true)

    if (legacyRecords.length > 0) {
      try {
        const storageRecords = await storageV2AppDataKvMirrorService.listRecords(scope, true)
        return filterAppDataRecords(mergeAppDataRecords(legacyRecords, storageRecords), includeDeleted)
      } catch (error) {
        logger.warn('Failed to merge Storage v2 app records into app-data list', error as Error)
        return records
      }
    }

    if (await storageV2AppDataRuntimeRecoveryService.projectIfLegacyAppRecordListEmpty(scope, 'app-data-list-empty')) {
      db = await getAppDataDatabase()
      return db.listRecords(scope, includeDeleted)
    }

    return storageV2AppDataKvMirrorService.listRecords(scope, includeDeleted)
  })

  ipcMain.handle(IpcChannel.AppCache_Get, async (_, namespace: string, key: string) => {
    const db = await getAppDataDatabase()
    const entry = await db.getCacheEntry(namespace, key)
    return entry.found ? entry.value : storageV2AppDataKvMirrorService.getCache(namespace, key)
  })

  ipcMain.handle(IpcChannel.AppCache_Set, async (_, namespace: string, key: string, value: unknown, ttlMs?: number) => {
    const db = await getAppDataDatabase()
    const updatedAt = Date.now()
    await storageV2AppDataKvMirrorService.upsertCache(namespace, key, value, ttlMs, updatedAt)
    await db.setCache(namespace, key, value, ttlMs, updatedAt, { storageV2Mirrored: true })
  })

  ipcMain.handle(IpcChannel.AppCache_Delete, async (_, namespace: string, key: string) => {
    const db = await getAppDataDatabase()
    const deletedAt = Date.now()
    await storageV2AppDataKvMirrorService.deleteCache(namespace, key, deletedAt)
    await db.deleteCache(namespace, key, { storageV2Mirrored: true })
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_List, async () => {
    let db = await getAppDataDatabase()
    const shortcuts = await db.listWorkbenchShortcuts()
    if (shortcuts.length > 0) {
      try {
        const legacyShortcuts = await db.listWorkbenchShortcuts(true)
        const storageShortcuts = await storageV2AppDataKvMirrorService.listWorkbenchShortcuts(true)
        return filterWorkbenchShortcuts(mergeWorkbenchShortcuts(legacyShortcuts, storageShortcuts))
      } catch (error) {
        logger.warn('Failed to merge Storage v2 workbench shortcuts into shortcut list', error as Error)
        return shortcuts
      }
    }

    if (await db.hasWorkbenchShortcutRows()) {
      try {
        const legacyShortcuts = await db.listWorkbenchShortcuts(true)
        const storageShortcuts = await storageV2AppDataKvMirrorService.listWorkbenchShortcuts(true)
        return filterWorkbenchShortcuts(mergeWorkbenchShortcuts(legacyShortcuts, storageShortcuts))
      } catch (error) {
        logger.warn('Failed to merge Storage v2 workbench shortcuts into tombstoned shortcut list', error as Error)
        return shortcuts
      }
    }

    if (
      await storageV2AppDataRuntimeRecoveryService.projectIfLegacyWorkbenchShortcutListEmpty('workbench-list-empty')
    ) {
      db = await getAppDataDatabase()
      return db.listWorkbenchShortcuts()
    }

    return storageV2AppDataKvMirrorService.listWorkbenchShortcuts()
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_Upsert, async (_, shortcut) => {
    const db = await getAppDataDatabase()
    const savedShortcut = createWorkbenchShortcutRecord(shortcut, Date.now())
    await storageV2AppDataKvMirrorService.upsertWorkbenchShortcut(savedShortcut)
    await db.upsertWorkbenchShortcut(savedShortcut, { storageV2Mirrored: true })
    return savedShortcut
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_InstallHtml, async (_, input: { title?: string; html: string }) => {
    const db = await getAppDataDatabase()
    const installed = await db.prepareHtmlArtifactShortcut(input, Date.now())
    await storageV2AppDataKvMirrorService.upsertWorkbenchShortcut(installed)
    await db.upsertWorkbenchShortcut(installed, { storageV2Mirrored: true })
    return installed
  })

  ipcMain.handle(IpcChannel.DataSync_SyncNow, async (_, config: WebDavConfig) => {
    try {
      return await appDataSyncService.syncNow(config)
    } catch (error) {
      const message = getDataSyncUserErrorMessage(error, '同步数据')
      if (!isDataSyncAlreadyRunningMessage(message)) {
        await rememberDataSyncFailure(message)
      }
      throw new Error(message)
    }
  })
  ipcMain.handle(IpcChannel.DataSync_RestoreLatestSnapshot, async (_, config: WebDavConfig) => {
    try {
      return await appDataSyncService.restoreLatestSnapshot(config)
    } catch (error) {
      throwDataSyncUserError(error, '恢复安全快照')
    }
  })
  ipcMain.handle(IpcChannel.DataSync_GetStatus, async () => appDataSyncService.getStatus())
  ipcMain.handle(IpcChannel.DataSync_GetConfig, async () => readDataSyncConfig())
  ipcMain.handle(IpcChannel.DataSync_SetConfig, async (_, input: unknown) => writeDataSyncConfig(input))
  ipcMain.handle(IpcChannel.DataSync_ListRemoteDirectories, async (_, config: WebDavConfig, remotePath?: string) => {
    try {
      return await appDataSyncService.listRemoteDirectories(config, remotePath)
    } catch (error) {
      throwDataSyncUserError(error, '读取远程目录')
    }
  })
  ipcMain.handle(IpcChannel.DataSync_CheckWriteAccess, async (_, config: WebDavConfig) => {
    try {
      return await appDataSyncService.checkWriteAccess(config)
    } catch (error) {
      throwDataSyncUserError(error, '检查同步写入权限')
    }
  })
  ipcMain.handle(IpcChannel.DataSync_RecordFailure, async (_, message: string) => {
    const failureMessage = message?.trim() || '同步数据失败：发生未知错误。'
    await rememberDataSyncFailure(failureMessage, { preserveLastSummary: true })
  })
}
