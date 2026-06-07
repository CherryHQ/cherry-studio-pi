import { loggerService } from '@logger'
import { shell } from 'electron'

const logger = loggerService.withContext('OpenExternal')

export function openExternalUrl(url: string, context = 'external URL'): void {
  void shell.openExternal(url).catch((error) => {
    logger.warn(`Failed to open ${context}: ${url}`, error as Error)
  })
}
