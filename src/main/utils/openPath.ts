import { loggerService } from '@logger'
import { shell } from 'electron'

import { summarizeTextForLog } from './logging'

const logger = loggerService.withContext('OpenPath')

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:(?:[\\/]|$)/

function validateOpenPathTarget(target: string): string {
  if (target.trim().length === 0) {
    throw new Error('Invalid path: empty path')
  }

  if (target.includes('\0')) {
    throw new Error('Invalid path: NUL bytes are not allowed')
  }

  const trimmedTarget = target.trimStart()
  if (URL_SCHEME_PATTERN.test(trimmedTarget) && !WINDOWS_DRIVE_PATH_PATTERN.test(trimmedTarget)) {
    throw new Error('Invalid path: URL schemes are not allowed')
  }

  return target
}

export async function openPathInShell(target: string): Promise<void> {
  const safeTarget = validateOpenPathTarget(target)
  const errorMessage = await shell.openPath(safeTarget)
  if (errorMessage) {
    throw new Error(errorMessage)
  }
}

export function openPathInShellAndLog(target: string, context = 'path'): void {
  void openPathInShell(target).catch((error) => {
    logger.warn(`Failed to open ${context}`, { target: summarizeTextForLog(target), error })
  })
}
