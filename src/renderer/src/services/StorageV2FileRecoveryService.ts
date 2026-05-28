import { loggerService } from '@logger'
import db from '@renderer/databases'
import type { FileMetadata, FileType } from '@renderer/types'

const logger = loggerService.withContext('StorageV2FileRecoveryService')

function hasStorageV2FileRecoveryApi() {
  return (
    typeof window.api?.storageV2?.listFiles === 'function' &&
    typeof window.api?.storageV2?.getFile === 'function' &&
    typeof window.api?.storageV2?.projectFilesToLegacyRuntime === 'function'
  )
}

class StorageV2FileRecoveryService {
  private projectAllPromise: Promise<boolean> | null = null

  async projectFilesIfEmpty(reason: string): Promise<boolean> {
    if (this.projectAllPromise) {
      return this.projectAllPromise
    }

    this.projectAllPromise = this.projectFilesIfEmptyNow(reason).finally(() => {
      this.projectAllPromise = null
    })

    return this.projectAllPromise
  }

  async projectMissingFiles(reason: string): Promise<boolean> {
    if (!hasStorageV2FileRecoveryApi()) return false

    if (this.projectAllPromise) {
      await this.projectAllPromise
    }

    try {
      const files = (await window.api.storageV2.listFiles()) as FileMetadata[]
      if (files.length === 0) return false

      const missingFiles: FileMetadata[] = []
      for (const file of files) {
        if (!file.id || (await db.files.get(file.id))) continue
        missingFiles.push(file)
      }

      if (missingFiles.length === 0) return false

      await window.api.storageV2.projectFilesToLegacyRuntime()
      await db.files.bulkPut(missingFiles)

      logger.info(`Projected ${missingFiles.length} missing Storage v2 file metadata row(s) into Dexie`, { reason })
      return true
    } catch (error) {
      logger.warn('Failed to project missing Storage v2 files into Dexie', error as Error)
      return false
    }
  }

  private async projectFilesIfEmptyNow(reason: string): Promise<boolean> {
    if ((await db.files.count()) > 0) return false
    if (!hasStorageV2FileRecoveryApi()) return false

    try {
      const files = (await window.api.storageV2.listFiles()) as FileMetadata[]
      if (files.length === 0) return false

      await window.api.storageV2.projectFilesToLegacyRuntime()
      await db.files.bulkPut(files)

      logger.info(`Projected ${files.length} Storage v2 file metadata row(s) into Dexie`, { reason })
      return true
    } catch (error) {
      logger.warn('Failed to project Storage v2 files into Dexie', error as Error)
      return false
    }
  }

  async projectFileIfMissing(fileId: string, reason: string): Promise<boolean> {
    if (!fileId) return false
    if (await db.files.get(fileId)) return false
    if (!hasStorageV2FileRecoveryApi()) return false

    if (this.projectAllPromise) {
      await this.projectAllPromise
      return Boolean(await db.files.get(fileId))
    }

    try {
      const file = (await window.api.storageV2.getFile(fileId)) as FileMetadata | null
      if (!file) return false

      await window.api.storageV2.projectFilesToLegacyRuntime()
      await db.files.put(file)

      logger.info('Projected Storage v2 file metadata row into Dexie', { fileId, reason })
      return true
    } catch (error) {
      logger.warn('Failed to project Storage v2 file metadata row into Dexie', error as Error)
      return false
    }
  }

  async listFilesWithFallback(fileType: FileType | 'all', reason: string): Promise<FileMetadata[]> {
    await this.projectMissingFiles(reason)

    if (fileType === 'all') {
      return db.files.orderBy('count').toArray()
    }

    return db.files.where('type').equals(fileType).sortBy('count')
  }
}

export const storageV2FileRecoveryService = new StorageV2FileRecoveryService()
