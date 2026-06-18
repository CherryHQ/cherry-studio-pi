import { loggerService } from '@logger'
import { notifyStorageV2MirroredLocalStorageKeyChanged } from '@renderer/services/StorageV2LocalStorageSnapshot'

const logger = loggerService.withContext('McpProviderTokenStorage')

export function saveMcpProviderToken(key: string, token: string): boolean {
  if (typeof localStorage === 'undefined') {
    return false
  }

  try {
    localStorage.setItem(key, token)
    notifyStorageV2MirroredLocalStorageKeyChanged(key)
    return true
  } catch (error) {
    logger.warn(`Failed to save MCP provider token ${key}`, error as Error)
    return false
  }
}

export function getMcpProviderToken(key: string): string | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  try {
    return localStorage.getItem(key)
  } catch (error) {
    logger.warn(`Failed to read MCP provider token ${key}`, error as Error)
    return null
  }
}

export function clearMcpProviderToken(key: string): boolean {
  if (typeof localStorage === 'undefined') {
    return false
  }

  try {
    localStorage.removeItem(key)
    notifyStorageV2MirroredLocalStorageKeyChanged(key, { cleared: true })
    return true
  } catch (error) {
    logger.warn(`Failed to clear MCP provider token ${key}`, error as Error)
    return false
  }
}
