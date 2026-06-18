import { loggerService } from '@renderer/services/LoggerService'

const logger = loggerService.withContext('MigrationLocalStorageAccess')

function getLocalStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function readLocalStorageItem(source: string, key: string): string | null {
  const storage = getLocalStorage()
  if (!storage) return null

  try {
    return storage.getItem(key)
  } catch (error) {
    logger.warn(`${source}: Failed to read localStorage item ${key}`, error as Error)
    return null
  }
}

export function getLocalStorageLength(source: string): number {
  const storage = getLocalStorage()
  if (!storage) return 0

  try {
    return storage.length
  } catch (error) {
    logger.warn(`${source}: Failed to read localStorage length`, error as Error)
    return 0
  }
}

export function getLocalStorageKey(source: string, index: number): string | null {
  const storage = getLocalStorage()
  if (!storage) return null

  try {
    return storage.key(index)
  } catch (error) {
    logger.warn(`${source}: Failed to read localStorage key at index ${index}`, error as Error)
    return null
  }
}
