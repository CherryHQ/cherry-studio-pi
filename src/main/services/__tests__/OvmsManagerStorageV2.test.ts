import * as fs from 'fs-extra'
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
  homedir: vi.fn(),
  settingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.exec
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

vi.mock('@main/constant', () => ({
  isWin: true
}))

vi.mock('@main/utils/system', () => ({
  getCpuName: vi.fn(() => 'Intel Core')
}))

vi.mock('@shared/config/constant', () => ({
  HOME_CHERRY_DIR: '.cherrystudio'
}))

vi.mock('../storageV2/StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository
}))

async function loadOvmsManager() {
  vi.resetModules()
  const { OvmsManager } = await import('../OvmsManager')
  return new OvmsManager()
}

const configPath = '/mock/home/.cherrystudio/ovms/ovms/models/config.json'

describe('OvmsManager Storage v2 config projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.homedir.mockReturnValue('/mock/home')
    mocks.fs.ensureDir.mockResolvedValue(undefined)
    mocks.fs.pathExists.mockResolvedValue(false)
    mocks.fs.readJson.mockResolvedValue({ mediapipe_config_list: [] })
    mocks.fs.stat.mockResolvedValue({ mtimeMs: Date.parse('2026-01-01T00:00:00.000Z') })
    mocks.fs.writeJson.mockResolvedValue(undefined)
    mocks.settingsRepository.get.mockResolvedValue(null)
    mocks.settingsRepository.set.mockResolvedValue({ key: 'ovms.model_config' })
  })

  it('writes updated OVMS model config to Storage v2 before the runtime JSON projection', async () => {
    mocks.fs.pathExists.mockImplementation(async (targetPath) => String(targetPath) === configPath)
    mocks.fs.readJson.mockResolvedValue({
      mediapipe_config_list: [{ name: 'stable diffusion', base_path: 'runwayml/stable-diffusion-v1-5' }],
      model_config_list: []
    })
    const manager = await loadOvmsManager()

    await expect(manager.updateModelConfig('FLUX', 'black-forest-labs/FLUX.1-dev')).resolves.toBe(true)

    const finalSettingCall = mocks.settingsRepository.set.mock.calls.at(-1)
    expect(finalSettingCall).toEqual([
      'ovms.model_config',
      {
        config: {
          mediapipe_config_list: [
            { name: 'stable diffusion', base_path: 'runwayml/stable-diffusion-v1-5' },
            { name: 'FLUX', base_path: 'black-forest-labs/FLUX.1-dev' }
          ],
          model_config_list: []
        },
        sourcePath: configPath,
        updatedAt: expect.any(String)
      },
      'ovms'
    ])
    expect(mocks.settingsRepository.set.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.fs.writeJson.mock.invocationCallOrder.at(-1)!
    )
    expect(fs.writeJson).toHaveBeenCalledWith(
      configPath,
      {
        mediapipe_config_list: [
          { name: 'stable diffusion', base_path: 'runwayml/stable-diffusion-v1-5' },
          { name: 'FLUX', base_path: 'black-forest-labs/FLUX.1-dev' }
        ],
        model_config_list: []
      },
      { spaces: 2 }
    )
  })

  it('restores a missing OVMS runtime config projection from Storage v2', async () => {
    mocks.settingsRepository.get.mockResolvedValue({
      config: {
        mediapipe_config_list: [
          { name: 'stable diffusion XL', base_path: 'stabilityai/stable-diffusion-xl-base-1.0' },
          { name: 'embedding model', base_path: 'BAAI/bge-small-en-v1.5' }
        ],
        model_config_list: []
      },
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    const manager = await loadOvmsManager()

    await expect(manager.getModels()).resolves.toEqual([
      { name: 'stable diffusion XL', base_path: 'stabilityai/stable-diffusion-xl-base-1.0' }
    ])
    expect(fs.writeJson).toHaveBeenCalledWith(
      configPath,
      {
        mediapipe_config_list: [
          { name: 'stable diffusion XL', base_path: 'stabilityai/stable-diffusion-xl-base-1.0' },
          { name: 'embedding model', base_path: 'BAAI/bge-small-en-v1.5' }
        ],
        model_config_list: []
      },
      { spaces: 2 }
    )
  })

  it('does not update the OVMS runtime projection when the Storage v2 snapshot fails', async () => {
    mocks.settingsRepository.set.mockRejectedValueOnce(new Error('storage unavailable'))
    const manager = await loadOvmsManager()

    await expect(manager.updateModelConfig('FLUX', 'black-forest-labs/FLUX.1-dev')).resolves.toBe(false)

    expect(fs.writeJson).not.toHaveBeenCalled()
  })
})
