import { loggerService } from '@logger'
import { shell } from 'electron'

import { isSafeExternalUrl } from './externalUrlSafety'

const logger = loggerService.withContext('OpenExternal')

export function openExternalUrl(url: string, context = 'external URL'): void {
  if (!isSafeExternalUrl(url)) {
    logger.warn(`Blocked unsafe ${context}: ${url}`)
    return
  }

  void Promise.resolve(shell.openExternal(url)).catch((error) => {
    logger.warn(`Failed to open ${context}: ${url}`, error as Error)
  })
}
