import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  nativeTheme: {
    shouldUseDarkColors: false,
    themeSource: 'system',
    on: vi.fn(),
    removeListener: vi.fn()
  },
  preferenceService: {
    get: vi.fn(() => 'system'),
    set: vi.fn(),
    subscribeChange: vi.fn(() => ({ dispose: vi.fn() }))
  },
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return mocks.preferenceService
      throw new Error(`unexpected service: ${name}`)
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => mocks.logger)
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  },
  nativeTheme: mocks.nativeTheme
}))

import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'

import { BaseService } from '../../core/lifecycle'
import { ThemeService } from '../ThemeService'

function createWindow(send = vi.fn(), destroyed = false, webContentsDestroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      send,
      isDestroyed: vi.fn(() => webContentsDestroyed)
    }
  }
}

describe('ThemeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    mocks.nativeTheme.shouldUseDarkColors = false
    mocks.getAllWindows.mockReturnValue([createWindow()])
  })

  it('broadcasts native theme updates to renderer windows', () => {
    const send = vi.fn()
    mocks.getAllWindows.mockReturnValue([createWindow(send)])
    const service = new ThemeService()

    ;(service as unknown as { themeUpdatedHandler(): void }).themeUpdatedHandler()

    expect(send).toHaveBeenCalledWith(IpcChannel.NativeThemeUpdated, ThemeMode.light)
  })

  it('skips windows whose webContents has already been destroyed', () => {
    const destroyedWebContentsSend = vi.fn()
    const healthySend = vi.fn()
    mocks.getAllWindows.mockReturnValue([
      createWindow(destroyedWebContentsSend, false, true),
      createWindow(healthySend)
    ])
    const service = new ThemeService()

    ;(service as unknown as { themeUpdatedHandler(): void }).themeUpdatedHandler()

    expect(destroyedWebContentsSend).not.toHaveBeenCalled()
    expect(healthySend).toHaveBeenCalledWith(IpcChannel.NativeThemeUpdated, ThemeMode.light)
  })

  it('continues notifying renderer windows when one send fails', () => {
    const failingSend = vi.fn(() => {
      throw new Error('send failed')
    })
    const healthySend = vi.fn()
    mocks.nativeTheme.shouldUseDarkColors = true
    mocks.getAllWindows.mockReturnValue([createWindow(failingSend), createWindow(healthySend)])
    const service = new ThemeService()

    ;(service as unknown as { themeUpdatedHandler(): void }).themeUpdatedHandler()

    expect(failingSend).toHaveBeenCalledTimes(1)
    expect(healthySend).toHaveBeenCalledWith(IpcChannel.NativeThemeUpdated, ThemeMode.dark)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to notify renderer window about native theme update',
      expect.any(Error)
    )
  })
})
