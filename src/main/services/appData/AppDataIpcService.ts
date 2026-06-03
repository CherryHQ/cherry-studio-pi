import { loggerService } from '@logger'
import { storageV2AppDataKvMirrorService } from '@main/services/storageV2/AppDataKvMirrorService'
import { storageV2AppDataRuntimeRecoveryService } from '@main/services/storageV2/AppDataRuntimeRecoveryService'
import { describeWebDavUserFacingError } from '@main/services/WebDavRetry'
import { IpcChannel } from '@shared/IpcChannel'
import type { WebDavConfig } from '@types'
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
