import path from 'node:path'

import { bootConfigService } from '@main/data/bootConfig'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'

import { untildify } from './file'

export interface UserDataPathBootConfig {
  get(key: 'app.user_data_path'): BootConfigSchema['app.user_data_path']
  get(key: 'temp.user_data_relocation'): BootConfigSchema['temp.user_data_relocation']
  set(key: 'app.user_data_path', value: BootConfigSchema['app.user_data_path']): void
  set(key: 'temp.user_data_relocation', value: BootConfigSchema['temp.user_data_relocation']): void
  flush(): void
}

export interface PersistUserDataPathSelectionInput {
  selectedPath: string
  executablePath: string
  bootConfig?: UserDataPathBootConfig
}

export function resolveUserDataPathSelection(selectedPath: string): string {
  if (typeof selectedPath !== 'string' || selectedPath.trim().length === 0) {
    throw new Error('App data path is required')
  }

  return path.resolve(untildify(selectedPath))
}

export function persistUserDataPathSelection({
  selectedPath,
  executablePath,
  bootConfig = bootConfigService
}: PersistUserDataPathSelectionInput): string {
  if (typeof executablePath !== 'string' || executablePath.trim().length === 0) {
    throw new Error('Executable path is required')
  }

  const resolvedPath = resolveUserDataPathSelection(selectedPath)
  const current = bootConfig.get('app.user_data_path') ?? {}

  bootConfig.set('app.user_data_path', {
    ...current,
    [executablePath]: resolvedPath
  })
  bootConfig.set('temp.user_data_relocation', null)
  bootConfig.flush()

  return resolvedPath
}
