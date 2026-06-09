import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import type { FileMetadata } from '@renderer/types'
import { getFileDirectory } from '@renderer/utils'
import dayjs from 'dayjs'

import { storageV2FileRecoveryService } from './StorageV2FileRecoveryService'

const logger = loggerService.withContext('FileManager')

type FileLogSummary = Partial<
  Pick<FileMetadata, 'id' | 'name' | 'origin_name' | 'size' | 'ext' | 'type' | 'count' | 'tokens' | 'purpose'>
>

function summarizeFileForLog(file: FileMetadata | undefined): FileLogSummary | null {
  if (!file) return null

  return {
    id: file.id,
    name: file.name,
    origin_name: file.origin_name,
    size: file.size,
    ext: file.ext,
    type: file.type,
    count: file.count,
    tokens: file.tokens,
    purpose: file.purpose
  }
}

function getCachedFilesPath(): string | undefined {
  return cacheService.get('app.path.files')
}

function getStoredFilePath(file: FileMetadata): string {
  const filesPath = getCachedFilesPath()
  if (filesPath) return `${filesPath}/${file.id}${file.ext}`
  return file.path || `${file.id}${file.ext}`
}

class FileManager {
  private static async upsertStorageV2File(file: FileMetadata | undefined): Promise<void> {
    if (!file) return

    if (typeof window.api?.storageV2?.upsertFile !== 'function') {
      throw new Error('Storage v2 file upsert API unavailable')
    }

    try {
      await window.api.storageV2.upsertFile(file as unknown as Record<string, unknown>)
    } catch (error) {
      logger.warn('Failed to upsert file in Storage v2:', error as Error)
      throw error
    }
  }

  private static async deleteStorageV2File(id: string): Promise<void> {
    if (typeof window.api?.storageV2?.deleteFile !== 'function') {
      throw new Error('Storage v2 file delete API unavailable')
    }

    try {
      await window.api.storageV2.deleteFile(id)
    } catch (error) {
      logger.warn('Failed to tombstone file in Storage v2:', error as Error)
      throw error
    }
  }

  static async selectFiles(options?: Electron.OpenDialogOptions): Promise<FileMetadata[] | null> {
    return await window.api.file.select(options)
  }

  static async addFile(file: FileMetadata): Promise<FileMetadata> {
    const fileRecord = await db.files.get(file.id)

    if (fileRecord) {
      const updatedFile = { ...fileRecord, count: fileRecord.count + 1 }
      await this.upsertStorageV2File(updatedFile)
      await db.files.update(fileRecord.id, updatedFile)
      return updatedFile
    }

    await this.upsertStorageV2File(file)
    await db.files.add(file)

    return file
  }

  static async addFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.addFile(file)))
  }

  static async readBinaryImage(file: FileMetadata): Promise<Buffer> {
    const fileData = await window.api.file.binaryImage(file.id + file.ext)
    return fileData.data
  }

  static async readBase64File(file: FileMetadata): Promise<string> {
    const fileData = await window.api.file.base64File(file.id + file.ext)
    return fileData.data
  }

  static async addBase64File(file: FileMetadata): Promise<FileMetadata> {
    logger.info('Adding base64 file', summarizeFileForLog(file))

    const base64File = await window.api.file.base64File(file.id + file.ext)
    const fileRecord = await db.files.get(base64File.id)

    if (fileRecord) {
      const updatedFile = { ...fileRecord, count: fileRecord.count + 1 }
      await this.upsertStorageV2File(updatedFile)
      await db.files.update(fileRecord.id, updatedFile)
      return updatedFile
    }

    await this.upsertStorageV2File(base64File)
    await db.files.add(base64File)

    return base64File
  }

  static async uploadFile(file: FileMetadata): Promise<FileMetadata> {
    logger.info('Uploading file', summarizeFileForLog(file))

    const uploadFile = await window.api.file.upload(file)
    logger.info('Uploaded file', summarizeFileForLog(uploadFile))
    const fileRecord = await db.files.get(uploadFile.id)

    if (fileRecord) {
      const updatedFile = { ...fileRecord, count: fileRecord.count + 1 }
      await this.upsertStorageV2File(updatedFile)
      await db.files.update(fileRecord.id, updatedFile)
      return updatedFile
    }

    await this.upsertStorageV2File(uploadFile)
    await db.files.add(uploadFile)

    return uploadFile
  }

  static async uploadFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.uploadFile(file)))
  }

  static async getFile(id: string): Promise<FileMetadata | undefined> {
    let file = await db.files.get(id)

    if (!file) {
      const restored = await storageV2FileRecoveryService.projectFileIfMissing(id, 'file-manager-get-missing')
      if (restored) {
        file = await db.files.get(id)
      }
    }

    if (file) {
      file.path = getStoredFilePath(file)
    }

    return file
  }

  static getFilePath(file: FileMetadata) {
    return getStoredFilePath(file)
  }

  static async deleteFile(id: string, force: boolean = false): Promise<void> {
    const file = await this.getFile(id)

    logger.info('Deleting file', summarizeFileForLog(file))

    if (!file) {
      return
    }

    if (!force) {
      if (file.count > 1) {
        const updatedFile = { ...file, count: file.count - 1 }
        await this.upsertStorageV2File(updatedFile)
        await db.files.update(id, updatedFile)
        return
      }
    }

    await this.deleteStorageV2File(id)
    await db.files.delete(id)

    try {
      await window.api.file.delete(id + file.ext)
    } catch (error) {
      logger.error('Failed to delete file:', error as Error)
    }
  }

  static async deleteFiles(files: FileMetadata[]): Promise<void> {
    if (!files || files.length === 0) return

    const results = await Promise.allSettled(files.map((file) => this.deleteFile(file.id)))

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      logger.warn(`File deletions completed with ${failed.length} files failed to delete:`, failed)
      throw new Error(`Failed to delete ${failed.length} file(s)`)
    }
  }

  static async allFiles(): Promise<FileMetadata[]> {
    await storageV2FileRecoveryService.projectMissingFiles('file-manager-all')
    return db.files.toArray()
  }

  static isDangerFile(file: FileMetadata) {
    return ['.sh', '.bat', '.cmd', '.ps1', '.vbs', 'reg'].includes(file.ext)
  }

  static getSafePath(file: FileMetadata) {
    // use the path from the file metadata instead
    // this function is used to get path for files which are not in the filestorage
    return this.isDangerFile(file) ? getFileDirectory(file.path) : file.path
  }

  static getFileUrl(file: FileMetadata) {
    const filesPath = getCachedFilesPath()
    return 'file://' + (filesPath ? `${filesPath}/${file.name}` : file.path || file.name)
  }

  static async updateFile(file: FileMetadata) {
    if (!file.origin_name.includes(file.ext)) {
      file.origin_name = file.origin_name + file.ext
    }

    await this.upsertStorageV2File(file)
    await db.files.update(file.id, file)
  }

  static formatFileName(file: FileMetadata) {
    if (!file || !file.origin_name) {
      return ''
    }

    const date = dayjs(file.created_at).format('YYYY-MM-DD')

    if (file.origin_name.includes('pasted_text')) {
      return date + ' ' + i18n.t('message.attachments.pasted_text') + file.ext
    }

    if (file.origin_name.startsWith('temp_file') && file.origin_name.includes('image')) {
      return date + ' ' + i18n.t('message.attachments.pasted_image') + file.ext
    }

    return file.origin_name
  }
}

export default FileManager
