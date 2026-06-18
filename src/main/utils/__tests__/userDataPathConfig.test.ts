import path from 'node:path'

import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { describe, expect, it, vi } from 'vitest'

import {
  persistUserDataPathSelection,
  resolveUserDataPathSelection,
  type UserDataPathBootConfig
} from '../userDataPathConfig'

function createBootConfigStore(initial: Partial<BootConfigSchema> = {}) {
  const store: Partial<BootConfigSchema> = { ...initial }
  const bootConfig: UserDataPathBootConfig = {
    get: vi.fn((key: keyof BootConfigSchema) => store[key]) as UserDataPathBootConfig['get'],
    set: vi.fn((key: keyof BootConfigSchema, value: BootConfigSchema[keyof BootConfigSchema]) => {
      store[key] = value as never
    }) as UserDataPathBootConfig['set'],
    flush: vi.fn()
  }

  return {
    store,
    bootConfig
  }
}

describe('userDataPathConfig', () => {
  it('normalizes the selected path before persistence', () => {
    expect(resolveUserDataPathSelection('relative-data')).toBe(path.resolve('relative-data'))
  })

  it('rejects empty selected paths', () => {
    expect(() => resolveUserDataPathSelection('   ')).toThrow('App data path is required')
  })

  it('persists the selected path for the current executable while preserving other installs', () => {
    const { store, bootConfig } = createBootConfigStore({
      'app.user_data_path': {
        '/other/exe': '/other/data'
      },
      'temp.user_data_relocation': { status: 'pending', from: '/old', to: '/new' }
    })

    const resolved = persistUserDataPathSelection({
      selectedPath: 'relative-data',
      executablePath: '/current/exe',
      bootConfig
    })

    expect(resolved).toBe(path.resolve('relative-data'))
    expect(store['app.user_data_path']).toEqual({
      '/other/exe': '/other/data',
      '/current/exe': path.resolve('relative-data')
    })
    expect(store['temp.user_data_relocation']).toBe(null)
    expect(bootConfig.flush).toHaveBeenCalledTimes(1)
  })

  it('rejects empty executable paths', () => {
    const { bootConfig } = createBootConfigStore()

    expect(() =>
      persistUserDataPathSelection({
        selectedPath: '/data',
        executablePath: '',
        bootConfig
      })
    ).toThrow('Executable path is required')
  })
})
