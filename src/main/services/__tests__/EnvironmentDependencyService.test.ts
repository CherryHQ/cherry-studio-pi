import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn((filePath: string) => filePath === '/mock/resources/cli'),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
    promises: {
      rm: vi.fn(),
      cp: vi.fn()
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@main/core/platform', () => ({
  isWin: false
}))

vi.mock('@main/utils', () => ({
  getResourcePath: () => '/mock/resources'
}))

vi.mock('@main/utils/process', () => ({
  findExecutableInEnv: vi.fn(async () => null),
  getBinaryName: vi.fn(async (name: string) => name),
  getGitBashPathInfo: vi.fn(() => ({ path: null })),
  runInstallScript: vi.fn()
}))

vi.mock('@main/utils/rtk', () => ({
  disableManagedRuntime: vi.fn(),
  enableManagedRuntime: vi.fn(),
  extractRtkBinaries: vi.fn(async () => undefined),
  getUserBinDir: () => '/mock/bin',
  isManagedRuntimeDisabled: vi.fn(() => false)
}))

describe('EnvironmentDependencyService', () => {
  it('preserves symlinks when installing bundled CLI runtime files', async () => {
    const { environmentDependencyService } = await import('../EnvironmentDependencyService')

    await environmentDependencyService.installManagedRuntime()

    expect(fs.promises.rm).toHaveBeenCalledWith('/mock/bin/perry-cli', { force: true, recursive: true })
    expect(fs.promises.cp).toHaveBeenCalledWith('/mock/resources/cli', '/mock/bin/perry-cli', {
      recursive: true,
      verbatimSymlinks: true
    })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('/mock/bin', 'node'),
      expect.stringContaining('ELECTRON_RUN_AS_NODE'),
      'utf8'
    )
  })
})
