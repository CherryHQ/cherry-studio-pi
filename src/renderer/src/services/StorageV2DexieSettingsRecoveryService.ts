import { loggerService } from '@logger'
import db from '@renderer/databases'

const logger = loggerService.withContext('StorageV2DexieSettingsRecoveryService')

function getStorageV2SettingKey(id: string) {
  return `dexie.settings.${id}`
}

class StorageV2DexieSettingsRecoveryService {
  async projectSettingIfMissing(id: string, reason: string): Promise<boolean> {
    if (!id) return false

    try {
      if (await db.settings.get(id)) return false
      if (typeof window.api?.storageV2?.getSetting !== 'function') return false

      const value = await window.api.storageV2.getSetting(getStorageV2SettingKey(id))
      if (value === null) return false

      await db.settings.put({ id, value })
      logger.info('Projected Storage v2 Dexie setting into IndexedDB', { id, reason })
      return true
    } catch (error) {
      logger.warn('Failed to project Storage v2 Dexie setting into IndexedDB', error as Error)
      return false
    }
  }

  async getSetting<T = unknown>(id: string, reason: string): Promise<{ id: string; value: T } | undefined> {
    let setting = await db.settings.get(id)
    if (!setting) {
      await this.projectSettingIfMissing(id, reason)
      setting = await db.settings.get(id)
    }

    return setting as { id: string; value: T } | undefined
  }
}

export const storageV2DexieSettingsRecoveryService = new StorageV2DexieSettingsRecoveryService()
