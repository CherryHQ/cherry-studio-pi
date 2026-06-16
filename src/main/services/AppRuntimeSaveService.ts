import { loggerService } from '@logger'
import type { BrowserWindow } from 'electron'

import { configManager } from './ConfigManager'
import { storageV2AgentDbMirrorService } from './storageV2/AgentDbMirrorService'
import { storageV2KnowledgeMirrorService } from './storageV2/KnowledgeMirrorService'

const logger = loggerService.withContext('AppRuntimeSaveService')

export async function flushMainStorageV2RuntimeMirrors() {
  await configManager.flushPendingStorageV2ConfigStrict()
  await configManager.mirrorAllToStorageV2()
  await storageV2AgentDbMirrorService.flushStrict()
  await storageV2KnowledgeMirrorService.flushStrict()
}

export async function requestRendererSaveData(_window: BrowserWindow | null | undefined, _timeoutMs?: number) {
  // Renderer persistence was removed with the Storage v2 migration. Keep this
  // compatibility function as a fast no-op so old call sites do not wait for an
  // ack that no renderer registers anymore.
  void _window
  void _timeoutMs
  return false
}

export async function flushAppRuntimeData({
  window,
  timeoutMs
}: {
  window?: BrowserWindow | null
  timeoutMs?: number
} = {}) {
  const errors: Error[] = []

  try {
    await flushMainStorageV2RuntimeMirrors()
  } catch (error) {
    errors.push(error as Error)
  }

  try {
    await requestRendererSaveData(window, timeoutMs)
  } catch (error) {
    errors.push(error as Error)
  }

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join('; '))
  }

  logger.info('App runtime data flushed')
}
