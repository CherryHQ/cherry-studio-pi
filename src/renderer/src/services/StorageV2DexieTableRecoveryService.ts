import { loggerService } from '@logger'
import db from '@renderer/databases'

import { STORAGE_V2_DEXIE_TABLE_NAMES, type StorageV2DexieTableName } from './StorageV2DexieTableMirrorService'

const logger = loggerService.withContext('StorageV2DexieTableRecoveryService')

type StorageV2SettingRecord = {
  key?: string
  value?: unknown
}

type DexieTableLike = {
  count: () => Promise<number>
  get: (id: string) => Promise<unknown>
  put: (row: unknown) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getTable(tableName: StorageV2DexieTableName): DexieTableLike {
  return (db as unknown as Record<StorageV2DexieTableName, DexieTableLike>)[tableName]
}

function getSettingKey(tableName: StorageV2DexieTableName, rowId: string) {
  return `dexie.table.${tableName}.${rowId}`
}

function getSettingKeyPrefix(tableName: StorageV2DexieTableName) {
  return `dexie.table.${tableName}.`
}

function normalizeStorageRow(tableName: StorageV2DexieTableName, record: StorageV2SettingRecord) {
  if (!record.key?.startsWith(getSettingKeyPrefix(tableName))) return null
  if (!isRecord(record.value)) return null

  const id = record.key.slice(getSettingKeyPrefix(tableName).length)
  if (!id) return null

  return {
    ...record.value,
    id
  }
}

async function getStorageRows(tableName: StorageV2DexieTableName) {
  if (typeof window.api?.storageV2?.listSettings !== 'function') return []

  const records = (await window.api.storageV2.listSettings(`dexie-table:${tableName}`)) as StorageV2SettingRecord[]

  return records
    .map((record) => normalizeStorageRow(tableName, record))
    .filter((row): row is Record<string, unknown> & { id: string } => Boolean(row))
}

class StorageV2DexieTableRecoveryService {
  async projectTableIfEmpty(tableName: StorageV2DexieTableName, reason: string): Promise<boolean> {
    if (!STORAGE_V2_DEXIE_TABLE_NAMES.includes(tableName)) return false

    try {
      const table = getTable(tableName)
      if ((await table.count()) > 0) return false

      const rows = await getStorageRows(tableName)
      if (rows.length === 0) return false

      for (const row of rows) {
        await table.put(row)
      }

      logger.info(`Projected ${rows.length} Storage v2 ${tableName} row(s) into Dexie`, { reason })
      return true
    } catch (error) {
      logger.warn(`Failed to project Storage v2 ${tableName} rows into Dexie`, error as Error)
      return false
    }
  }

  async projectRowIfMissing(tableName: StorageV2DexieTableName, rowId: string, reason: string): Promise<boolean> {
    if (!STORAGE_V2_DEXIE_TABLE_NAMES.includes(tableName) || !rowId) return false

    try {
      const table = getTable(tableName)
      if (await table.get(rowId)) return false
      if (typeof window.api?.storageV2?.getSetting !== 'function') return false

      const value = await window.api.storageV2.getSetting(getSettingKey(tableName, rowId))
      if (!isRecord(value)) return false

      await table.put({
        ...value,
        id: rowId
      })

      logger.info(`Projected Storage v2 ${tableName} row into Dexie`, { rowId, reason })
      return true
    } catch (error) {
      logger.warn(`Failed to project Storage v2 ${tableName} row into Dexie`, error as Error)
      return false
    }
  }
}

export const storageV2DexieTableRecoveryService = new StorageV2DexieTableRecoveryService()
