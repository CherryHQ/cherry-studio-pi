import { loggerService } from '@logger'
import db from '@renderer/databases'
import { convertToBase64 } from '@renderer/utils'

import { storageV2DexieSettingsMirrorService } from './StorageV2DexieSettingsMirrorService'
import { storageV2DexieSettingsRecoveryService } from './StorageV2DexieSettingsRecoveryService'

const logger = loggerService.withContext('ImageStorage')

const IMAGE_PREFIX = 'image://'

export default class ImageStorage {
  static async set(key: string, value: File | string) {
    const id = IMAGE_PREFIX + key
    try {
      if (typeof value === 'string') {
        // string（emoji）
        await storageV2DexieSettingsMirrorService.putSettingAndFlush({ id, value })
      } else {
        // file image
        const base64Image = await convertToBase64(value)
        if (typeof base64Image === 'string') {
          await storageV2DexieSettingsMirrorService.putSettingAndFlush({ id, value: base64Image })
        }
      }
    } catch (error) {
      logger.error('Error storing the image', error as Error)
    }
  }

  static async get(key: string): Promise<string> {
    const id = IMAGE_PREFIX + key
    return (
      (await storageV2DexieSettingsRecoveryService.getSetting<string>(id, 'image-storage-get-missing'))?.value ?? ''
    )
  }

  static async remove(key: string): Promise<void> {
    const id = IMAGE_PREFIX + key
    try {
      storageV2DexieSettingsMirrorService.scheduleDelete(id)
      await storageV2DexieSettingsMirrorService.flushStrict()
      await db.settings.delete(id)
    } catch (error) {
      logger.error('Error removing the image', error as Error)
      throw error
    }
  }
}
