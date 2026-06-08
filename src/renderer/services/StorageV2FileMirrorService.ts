import { loggerService } from '@logger'
import db from '@renderer/databases'

import { notifyDataSyncLocalChange } from './DataSyncLocalChangeSignal'
import { getRendererStorageV2Api, type RendererStorageV2Api } from './StorageV2RendererApi'
import { serializeStorageV2MirrorError, type StorageV2RuntimeMirrorStatusEntry } from './StorageV2RuntimeMirrorStatus'

const logger = loggerService.withContext('StorageV2FileMirrorService')

const DEFAULT_DEBOUNCE_MS = 1500

class StorageV2FileMirrorService {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingFileIds = new Set<string>()
  private inflight: Promise<void> | null = null
  private needsFollowUp = false
  private suspended = false
  private lastError: unknown = null

  scheduleFile(fileId: string | undefined, debounceMs = DEFAULT_DEBOUNCE_MS) {
    if (this.suspended) return
    if (!fileId) return
    this.pendingFileIds.add(fileId)
    this.scheduleFlush(debounceMs)
  }

  scheduleFiles(fileIds: Iterable<string | undefined>, debounceMs = DEFAULT_DEBOUNCE_MS) {
    if (this.suspended) return
    let hasPending = false

    for (const fileId of fileIds) {
      if (!fileId) continue
      this.pendingFileIds.add(fileId)
      hasPending = true
    }

    if (hasPending) {
      this.scheduleFlush(debounceMs)
    }
  }

  async flush() {
    if (this.suspended) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.inflight) {
      this.needsFollowUp = true
      await this.inflight
      if (this.needsFollowUp) {
        this.needsFollowUp = false
        await this.flush()
      }
      return
    }

    if (this.pendingFileIds.size === 0) return

    const { hasWindow, api } = getRendererStorageV2Api()
    if (!api) {
      if (hasWindow) {
        this.scheduleFlush(DEFAULT_DEBOUNCE_MS)
      }
      return
    }

    this.inflight = this.mirrorPendingNow(api).finally(() => {
      this.inflight = null
    })

    await this.inflight
  }

  async flushStrict() {
    await this.flush()

    if (this.pendingFileIds.size === 0) return

    const { api } = getRendererStorageV2Api()
    if (!api) {
      throw new Error('Storage v2 API unavailable while file mirror work is pending')
    }

    if (this.lastError) {
      throw this.lastError instanceof Error ? this.lastError : new Error('Failed to mirror files to Storage v2')
    }

    throw new Error('File mirror work is still pending after strict flush')
  }

  private scheduleFlush(debounceMs: number) {
    if (this.timer) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, debounceMs)
  }

  private async mirrorPendingNow(storageV2: RendererStorageV2Api) {
    const fileIds = Array.from(this.pendingFileIds)
    this.pendingFileIds.clear()

    try {
      const files = await db.files.where('id').anyOf(fileIds).toArray()
      const foundFileIds = new Set(files.map((file) => file.id).filter(Boolean))
      const missingFileIds = fileIds.filter((fileId) => !foundFileIds.has(fileId))

      if (files.length > 0) {
        if (typeof storageV2.upsertFile === 'function') {
          for (const file of files) {
            await storageV2.upsertFile(file as unknown as Record<string, unknown>)
          }
        } else {
          await storageV2.importLegacyDexieSnapshot(
            {
              conversations: [],
              files
            },
            { dryRun: false }
          )
        }
      }

      for (const fileId of missingFileIds) {
        await storageV2.deleteFile(fileId)
      }

      logger.debug(
        `Mirrored ${files.length} file(s) and ${missingFileIds.length} missing file tombstone(s) to Storage v2`
      )
      this.lastError = null
      if (files.length > 0 || missingFileIds.length > 0) {
        notifyDataSyncLocalChange('file')
      }
    } catch (error) {
      for (const fileId of fileIds) {
        this.pendingFileIds.add(fileId)
      }
      this.lastError = error
      this.scheduleFlush(DEFAULT_DEBOUNCE_MS)
      logger.warn('Failed to mirror files to Storage v2', error as Error)
    }
  }

  suspendUntilReload() {
    this.suspended = true
    this.pendingFileIds.clear()
    this.needsFollowUp = false
    this.lastError = null

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  getStatus(): StorageV2RuntimeMirrorStatusEntry {
    return {
      id: 'files',
      pendingCount: this.pendingFileIds.size + (this.inflight ? 1 : 0),
      inflight: Boolean(this.inflight),
      suspended: this.suspended,
      lastError: serializeStorageV2MirrorError(this.lastError)
    }
  }
}

export const storageV2FileMirrorService = new StorageV2FileMirrorService()
