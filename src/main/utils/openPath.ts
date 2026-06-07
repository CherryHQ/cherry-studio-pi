import { loggerService } from '@logger'
import { shell } from 'electron'

const logger = loggerService.withContext('OpenPath')

export async function openPathInShell(target: string): Promise<void> {
  const errorMessage = await shell.openPath(target)
  if (errorMessage) {
    throw new Error(errorMessage)
  }
}

export function openPathInShellAndLog(target: string, context = 'path'): void {
  void openPathInShell(target).catch((error) => {
    logger.warn(`Failed to open ${context}: ${target}`, error as Error)
  })
}
