import { IpcChannel } from '@shared/IpcChannel'
import type { WebDavConfig } from '@types'
import { ipcMain } from 'electron'

import { getAppDataDatabase } from './AppDataDatabase'
import { appDataSyncService } from './AppDataSyncService'

export function registerAppDataIpcHandlers() {
  ipcMain.handle(IpcChannel.AppData_Get, async (_, scope: string, key: string) => {
    const db = await getAppDataDatabase()
    return db.getRecord(scope, key)
  })

  ipcMain.handle(IpcChannel.AppData_Set, async (_, scope: string, key: string, value: unknown) => {
    const db = await getAppDataDatabase()
    return db.setRecord(scope, key, value)
  })

  ipcMain.handle(IpcChannel.AppData_Delete, async (_, scope: string, key: string) => {
    const db = await getAppDataDatabase()
    await db.deleteRecord(scope, key)
  })

  ipcMain.handle(IpcChannel.AppData_List, async (_, scope?: string, includeDeleted?: boolean) => {
    const db = await getAppDataDatabase()
    return db.listRecords(scope, includeDeleted)
  })

  ipcMain.handle(IpcChannel.AppCache_Get, async (_, namespace: string, key: string) => {
    const db = await getAppDataDatabase()
    return db.getCache(namespace, key)
  })

  ipcMain.handle(IpcChannel.AppCache_Set, async (_, namespace: string, key: string, value: unknown, ttlMs?: number) => {
    const db = await getAppDataDatabase()
    await db.setCache(namespace, key, value, ttlMs)
  })

  ipcMain.handle(IpcChannel.AppCache_Delete, async (_, namespace: string, key: string) => {
    const db = await getAppDataDatabase()
    await db.deleteCache(namespace, key)
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_List, async () => {
    const db = await getAppDataDatabase()
    return db.listWorkbenchShortcuts()
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_Upsert, async (_, shortcut) => {
    const db = await getAppDataDatabase()
    return db.upsertWorkbenchShortcut(shortcut)
  })

  ipcMain.handle(IpcChannel.WorkbenchShortcut_InstallHtml, async (_, input: { title?: string; html: string }) => {
    const db = await getAppDataDatabase()
    return db.installHtmlArtifact(input)
  })

  ipcMain.handle(IpcChannel.DataSync_SyncNow, async (_, config: WebDavConfig) => appDataSyncService.syncNow(config))
  ipcMain.handle(IpcChannel.DataSync_GetStatus, async () => appDataSyncService.getStatus())
}
