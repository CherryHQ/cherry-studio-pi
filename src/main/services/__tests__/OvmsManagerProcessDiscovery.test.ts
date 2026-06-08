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
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, '{ broken json', ''))
    const manager = await loadOvmsManager()

    await expect(manager.initializeOvms()).resolves.toBe(false)
  })

  it('passes OVMS downloader input as execFile arguments instead of a shell command string', async () => {
    const ovmsDir = '/mock/home/.cherrystudio/ovms/ovms'
    mocks.fs.pathExists.mockResolvedValue(false)
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, 'downloaded', ''))
    const manager = await loadOvmsManager()
    const updateModelConfig = vi.spyOn(manager, 'updateModelConfig').mockResolvedValue(true)
    const applyModelPath = vi.spyOn(manager as any, 'applyModelPath').mockResolvedValue(true)

    await expect(
      manager.addModel('Model & Name', 'org/model";Remove-Item', 'https://hf.example.test', 'image_generation')
    ).resolves.toEqual({ success: true })

    expect(mocks.exec).toHaveBeenCalledWith(
      `${ovmsDir}/ovdnd.exe`,
      [
        '--pull',
        '--model_repository_path',
        `${ovmsDir}/models`,
        '--source_model',
        'org/model";Remove-Item',
        '--model_name',
        'Model & Name',
        '--target_device',
        'GPU',
        '--task',
        'image_generation',
        '--overwrite_models'
      ],
      expect.objectContaining({
        cwd: ovmsDir,
        env: expect.objectContaining({
          HF_ENDPOINT: 'https://hf.example.test',
          OVMS_DIR: ovmsDir
        })
      }),
      expect.any(Function)
    )
    expect(updateModelConfig).toHaveBeenCalledWith('Model & Name', 'org/model";Remove-Item')
    expect(applyModelPath).toHaveBeenCalledWith(`${ovmsDir}/models/org/model";Remove-Item`)
  })

  it('rejects model ids that would escape the OVMS models directory', async () => {
    mocks.fs.pathExists.mockResolvedValue(false)
    const manager = await loadOvmsManager()

    await expect(manager.addModel('Bad Model', '../escape', '', 'text_generation')).resolves.toMatchObject({
      success: false
    })

    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.fs.remove).not.toHaveBeenCalled()
  })
})
