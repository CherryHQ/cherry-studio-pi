import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsAnyOf: vi.fn(),
  settingsDelete: vi.fn(),
  settingsHook: vi.fn(),
  settingsPut: vi.fn(),
  settingsWhere: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    settings: {
      delete: mocks.settingsDelete,
      hook: mocks.settingsHook,
      put: mocks.settingsPut,
      where: mocks.settingsWhere
    }
  }
}))

describe('StorageV2DexieSettingsMirrorService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api

    mocks.settingsAnyOf.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'language',
          value: 'zh-CN'
        }
      ])
    })
    mocks.settingsWhere.mockReturnValue({
      anyOf: mocks.settingsAnyOf
    })
    mocks.settingsPut.mockResolvedValue(undefined)
    mocks.settingsDelete.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('mirrors Dexie settings and delete markers into Storage v2 settings', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)
    storageV2DexieSettingsMirrorService.scheduleDelete('image://avatar', 1000)
    await storageV2DexieSettingsMirrorService.flush()

    expect(setSetting).toHaveBeenCalledWith('dexie.settings.language', 'zh-CN', 'dexie-settings')
    expect(setSetting).toHaveBeenCalledWith('dexie.settings.image://avatar', null, 'dexie-settings')
  })

  it('writes a Dexie setting and immediately flushes the Storage v2 mirror', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })
    mocks.settingsAnyOf.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'translate:target:language',
          value: 'ja-JP'
        }
      ])
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    await storageV2DexieSettingsMirrorService.putSettingAndFlush({ id: 'translate:target:language', value: 'ja-JP' })

    expect(mocks.settingsPut).toHaveBeenCalledWith({ id: 'translate:target:language', value: 'ja-JP' })
    expect(setSetting).toHaveBeenCalledWith('dexie.settings.translate:target:language', 'ja-JP', 'dexie-settings')
  })

  it('does not mirror a putSettingAndFlush write again when the Dexie hook fires', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })
    mocks.settingsAnyOf.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'image://avatar',
          value: 'avatar-data'
        }
      ])
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')
    storageV2DexieSettingsMirrorService.install()
    const creatingHook = mocks.settingsHook.mock.calls.find(([eventName]) => eventName === 'creating')?.[1]
    mocks.settingsPut.mockImplementation(async (setting) => {
      creatingHook?.(setting.id, setting)
    })

    await storageV2DexieSettingsMirrorService.putSettingAndFlush({ id: 'image://avatar', value: 'avatar-data' })
    await vi.runOnlyPendingTimersAsync()

    expect(setSetting).toHaveBeenCalledTimes(1)
    expect(setSetting).toHaveBeenCalledWith('dexie.settings.image://avatar', 'avatar-data', 'dexie-settings')
  })

  it('deletes a Dexie setting and mirrors one tombstone when the Dexie hook fires', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')
    storageV2DexieSettingsMirrorService.install()
    const deletingHook = mocks.settingsHook.mock.calls.find(([eventName]) => eventName === 'deleting')?.[1]
    mocks.settingsDelete.mockImplementation(async (settingId) => {
      deletingHook?.(settingId)
    })

    await storageV2DexieSettingsMirrorService.deleteSettingAndFlush('image://avatar', { strict: true })
    await vi.runOnlyPendingTimersAsync()

    expect(mocks.settingsDelete).toHaveBeenCalledWith('image://avatar')
    expect(setSetting).toHaveBeenCalledTimes(1)
    expect(setSetting).toHaveBeenCalledWith('dexie.settings.image://avatar', null, 'dexie-settings')
  })

  it('does not keep the renderer process alive while debounce flushing Dexie settings mirrors', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(unref).toHaveBeenCalledTimes(1)
  })

  it('does not keep the renderer process alive while deferring Dexie settings hook callbacks', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.install()
    const creatingHook = mocks.settingsHook.mock.calls.find(([eventName]) => eventName === 'creating')?.[1]

    expect(creatingHook).toBeTypeOf('function')
    creatingHook?.('language', { id: 'language', value: 'zh-CN' })

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0)
    expect(unref).toHaveBeenCalledTimes(1)
  })

  it('delays retry after a transient Storage v2 settings mirror failure', async () => {
    const setSetting = vi.fn().mockRejectedValueOnce(new Error('storage busy')).mockResolvedValueOnce(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)
    await storageV2DexieSettingsMirrorService.flush()

    expect(setSetting).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4999)
    expect(setSetting).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(setSetting).toHaveBeenCalledTimes(2)
  })

  it('rejects strict flushes when a settings mirror write is still pending after failure', async () => {
    const setSetting = vi.fn().mockRejectedValue(new Error('storage busy'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)

    await expect(storageV2DexieSettingsMirrorService.flushStrict()).rejects.toThrow('storage busy')
    expect(setSetting).toHaveBeenCalledTimes(1)
  })

  it('rejects strict flushes when Storage v2 API is unavailable with pending settings work', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleDelete('image://avatar', 1000)

    await expect(storageV2DexieSettingsMirrorService.flushStrict()).rejects.toThrow(
      'Storage v2 API unavailable while Dexie settings mirror work is pending'
    )
  })

  it('retries pending settings mirrors when Storage v2 API becomes available later', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })

    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')

    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)
    await storageV2DexieSettingsMirrorService.flush()

    expect(mocks.settingsWhere).not.toHaveBeenCalled()

    const setSetting = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          setSetting
        }
      }
    })

    await vi.advanceTimersByTimeAsync(4999)
    expect(setSetting).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(setSetting).toHaveBeenCalledWith('dexie.settings.language', 'zh-CN', 'dexie-settings')
  })

  it('does not keep retrying after the renderer window has been torn down', async () => {
    const { storageV2DexieSettingsMirrorService } = await import('../StorageV2DexieSettingsMirrorService')
    storageV2DexieSettingsMirrorService.scheduleSetting('language', 1000)

    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await storageV2DexieSettingsMirrorService.flush()
      await vi.advanceTimersByTimeAsync(5000)
    } finally {
      vi.stubGlobal('window', originalWindow)
    }

    expect(mocks.settingsWhere).not.toHaveBeenCalled()
    expect(storageV2DexieSettingsMirrorService.getStatus().pendingCount).toBe(1)
  })
})
