import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

import { storageV2SettingsRepository } from '../storageV2/StorageV2Repositories'

export const CUSTOM_MIN_APPS_FILE_NAME = 'custom-minapps.json'

const CUSTOM_MIN_APPS_SETTING_KEY = 'minapps.custom'
const CUSTOM_MIN_APPS_SETTING_SCOPE = 'minapps'

const logger = loggerService.withContext('CustomMiniAppsStorageV2')

function parseCustomMiniAppsContent(content: string): unknown[] {
  const apps = JSON.parse(content)
  if (!Array.isArray(apps)) {
    throw new Error('Custom mini apps content must be a JSON array.')
  }
  return apps
}

function toCustomMiniAppsContent(value: unknown): string | null {
  if (Array.isArray(value)) {
    return JSON.stringify(value, null, 2)
  }
  if (typeof value === 'string') {
    return JSON.stringify(parseCustomMiniAppsContent(value), null, 2)
  }
  return null
}

export function normalizeCustomMiniAppsContent(content: string): string {
  return JSON.stringify(parseCustomMiniAppsContent(content), null, 2)
}

export async function loadCustomMiniAppsContentFromStorageV2(): Promise<string | null> {
  const value = await storageV2SettingsRepository.get(CUSTOM_MIN_APPS_SETTING_KEY)
  return toCustomMiniAppsContent(value)
}

export async function mirrorCustomMiniAppsContentToStorageV2(content: string): Promise<void> {
  await storageV2SettingsRepository.set(
    CUSTOM_MIN_APPS_SETTING_KEY,
    parseCustomMiniAppsContent(content),
    CUSTOM_MIN_APPS_SETTING_SCOPE
  )
}

export async function writeLegacyCustomMiniAppsFile(filePath: string, content: string): Promise<void> {
  const normalized = normalizeCustomMiniAppsContent(content)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, normalized, 'utf8')
}

export async function hydrateCustomMiniAppsFileFromStorageV2(filePath: string): Promise<string | null> {
  const content = await loadCustomMiniAppsContentFromStorageV2()
  if (content === null) return null

  await writeLegacyCustomMiniAppsFile(filePath, content).catch((error) => {
    logger.warn('Failed to project Storage v2 custom mini apps into legacy file', {
      error: error instanceof Error ? error.message : String(error)
    })
  })
  return content
}
