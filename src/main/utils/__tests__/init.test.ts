import * as fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fs: {
    accessSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    constants: {
      W_OK: 2
    }
  },
  homedir: vi.fn(),
  getPath: vi.fn(),
  setPath: vi.fn(),
  platform: {
    isLinux: false,
    isPortable: false,
    isWin: false
  }
}))

vi.mock('node:fs', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('node:os', () => ({
  default: {
    homedir: mocks.homedir
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    setPath: mocks.setPath
  }
}))

vi.mock('@main/constant', () => ({
  get isLinux() {
    return mocks.platform.isLinux
  },
  get isPortable() {
    return mocks.platform.isPortable
  },
  get isWin() {
    return mocks.platform.isWin
  }
}))

vi.mock('@shared/config/constant', () => ({
  HOME_CHERRY_DIR: '.cherrystudio'
}))

describe('updateAppDataConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.homedir.mockReturnValue('/mock/home')
    mocks.getPath.mockImplementation((key: string) => {
      if (key === 'exe') return '/Applications/Cherry Studio Pi.app/Contents/MacOS/Cherry Studio Pi'
      return '/mock/unknown'
    })
    mocks.fs.existsSync.mockReturnValue(false)
    mocks.fs.accessSync.mockReturnValue(undefined as never)
    mocks.fs.mkdirSync.mockReturnValue(undefined as never)
    mocks.fs.writeFileSync.mockReturnValue(undefined as never)
    mocks.fs.renameSync.mockReturnValue(undefined as never)
    mocks.platform.isLinux = false
    mocks.platform.isPortable = false
    mocks.platform.isWin = false
    delete process.env.APPIMAGE
    delete process.env.PORTABLE_EXECUTABLE_DIR
    delete process.env.PORTABLE_EXECUTABLE_FILE
  })

  it('creates app data config with an atomic temp-file rename', async () => {
    const { updateAppDataConfig } = await import('../init')

    updateAppDataConfig('/mock/new-user-data')

    const configPath = '/mock/home/.cherrystudio/config/config.json'
    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.cherrystudio/config', { recursive: true })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\/mock\/home\/\.cherrystudio\/config\/config\.json\.\d+\.\d+\.tmp$/),
      expect.stringContaining('"dataPath": "/mock/new-user-data"')
    )
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining(`${configPath}.`), configPath)
  })

  it('preserves existing dataRoots when updating an app data path entry', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, '/mock/home/.cherrystudio/config'].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockReturnValue(
      JSON.stringify({
        dataRoots: [
          {
            app: 'cherry-studio-pi',
            path: '/mock/active/Data',
            active: true
          }
        ],
        appDataPath: [
          {
            executablePath: '/Applications/Cherry Studio Pi.app/Contents/MacOS/Cherry Studio Pi',
            dataPath: '/mock/old-user-data'
          }
        ]
      })
    )

    const { updateAppDataConfig } = await import('../init')

    updateAppDataConfig('/mock/new-user-data')

    const writtenConfig = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]))
    expect(writtenConfig.dataRoots).toEqual([
      {
        app: 'cherry-studio-pi',
        path: '/mock/active/Data',
        active: true
      }
    ])
    expect(writtenConfig.appDataPath).toEqual([
      {
        executablePath: '/Applications/Cherry Studio Pi.app/Contents/MacOS/Cherry Studio Pi',
        dataPath: '/mock/new-user-data'
      }
    ])
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining(`${configPath}.`), configPath)
  })

  it('uses the real AppImage path instead of the legacy Cherry Studio executable name', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    mocks.platform.isLinux = true
    process.env.APPIMAGE = '/Applications/Cherry Studio Pi.AppImage'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, '/mock/linux-user-data'].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockReturnValue(
      JSON.stringify({
        appDataPath: [
          {
            executablePath: '/Applications/Cherry Studio Pi.AppImage',
            dataPath: '/mock/linux-user-data'
          }
        ]
      })
    )

    const { initAppDataDir } = await import('../init')

    initAppDataDir()

    expect(mocks.setPath).toHaveBeenCalledWith('userData', '/mock/linux-user-data')
  })

  it('can still read app data entries written with the legacy AppImage filename', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    mocks.platform.isLinux = true
    process.env.APPIMAGE = '/Applications/Cherry Studio Pi.AppImage'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, '/mock/legacy-linux-user-data'].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockReturnValue(
      JSON.stringify({
        appDataPath: [
          {
            executablePath: '/Applications/cherry-studio.appimage',
            dataPath: '/mock/legacy-linux-user-data'
          }
        ]
      })
    )

    const { initAppDataDir } = await import('../init')

    initAppDataDir()

    expect(mocks.setPath).toHaveBeenCalledWith('userData', '/mock/legacy-linux-user-data')
  })

  it('uses PORTABLE_EXECUTABLE_FILE for Windows portable app data entries', async () => {
    mocks.platform.isWin = true
    mocks.platform.isPortable = true
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\Portable'
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Portable\\Cherry Studio Pi-1.9.21-x64-portable.exe'

    const { updateAppDataConfig } = await import('../init')

    updateAppDataConfig('C:\\Portable\\data')

    const writtenConfig = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]))
    expect(writtenConfig.appDataPath).toEqual([
      {
        executablePath: 'C:\\Portable\\Cherry Studio Pi-1.9.21-x64-portable.exe',
        dataPath: 'C:\\Portable\\data'
      }
    ])
  })
})
