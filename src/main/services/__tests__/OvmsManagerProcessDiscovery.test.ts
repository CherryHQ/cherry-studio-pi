import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  fs: {
    copyFile: vi.fn(),
    ensureDir: vi.fn(),
    lstatSync: vi.fn(),
    pathExists: vi.fn(),
    readJson: vi.fn(),
    readdir: vi.fn(),
    remove: vi.fn(),
    stat: vi.fn(),
    writeJson: vi.fn()
  },
  homedir: vi.fn()
}))

vi.mock('node:child_process', () => ({
  exec: mocks.exec
}))

vi.mock('node:os', () => ({
  homedir: mocks.homedir
}))

vi.mock('fs-extra', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@shared/config/constant', () => ({
  HOME_CHERRY_DIR: '.cherrystudio'
}))

async function loadOvmsManager() {
  vi.resetModules()
  const { OvmsManager } = await import('../OvmsManager')
  return new OvmsManager()
}

describe('OvmsManager process discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.homedir.mockReturnValue('/mock/home')
  })

  it('returns false when OVMS process discovery returns malformed PowerShell JSON', async () => {
    mocks.exec.mockImplementation((_command, callback) => callback(null, '{ broken json', ''))
    const manager = await loadOvmsManager()

    await expect(manager.initializeOvms()).resolves.toBe(false)
  })
})
