import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: {
    setLoginItemSettings: vi.fn()
  },
  application: {
    getPath: vi.fn()
  },
  fsPromises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn()
  },
  logger: {
    info: vi.fn(),
    error: vi.fn()
  },
  os: {
    homedir: vi.fn()
  },
  platform: {
    isDev: false,
    isLinux: true,
    isMac: false,
    isWin: false
  }
}))

vi.mock('@application', () => ({
  application: mocks.application
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@main/core/platform', () => mocks.platform)

vi.mock('electron', () => ({
  app: mocks.app
}))

vi.mock('fs', () => ({
  default: {
    promises: mocks.fsPromises
  },
  promises: mocks.fsPromises
}))

vi.mock('os', () => ({
  default: mocks.os,
  homedir: mocks.os.homedir
}))

import { AppService } from '../AppService'

describe('AppService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.APPIMAGE
    mocks.platform.isDev = false
    mocks.platform.isLinux = true
    mocks.platform.isMac = false
    mocks.platform.isWin = false
    mocks.os.homedir.mockReturnValue('/home/cherry')
    mocks.application.getPath.mockReturnValue('/opt/Cherry Studio Pi/cherry-studio-pi')
    mocks.fsPromises.access.mockResolvedValue(undefined)
    mocks.fsPromises.mkdir.mockResolvedValue(undefined)
    mocks.fsPromises.writeFile.mockResolvedValue(undefined)
    mocks.fsPromises.unlink.mockResolvedValue(undefined)
  })

  it('writes a valid Linux autostart desktop file for AppImage paths with spaces', async () => {
    process.env.APPIMAGE = "/home/cherry/Apps/Cherry Studio Pi's Nightly.AppImage"

    await new AppService().setAppLaunchOnBoot(true)

    expect(mocks.fsPromises.writeFile).toHaveBeenCalledTimes(1)
    const [desktopFile, content] = mocks.fsPromises.writeFile.mock.calls[0]
    expect(desktopFile).toBe('/home/cherry/.config/autostart/cherry-studio-pi.desktop')
    expect(content).toContain('[Desktop Entry]\nType=Application\nName=Cherry Studio Pi\n')
    expect(content).toContain('Exec="/home/cherry/Apps/Cherry Studio Pi\'s Nightly.AppImage"')
    expect(content).not.toContain('\n  Type=')
  })

  it('uses Electron login item settings on Windows and macOS', async () => {
    mocks.platform.isLinux = false
    mocks.platform.isWin = true

    await new AppService().setAppLaunchOnBoot(true)

    expect(mocks.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
    expect(mocks.fsPromises.writeFile).not.toHaveBeenCalled()
  })
})
