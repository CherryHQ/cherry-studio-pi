import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsPut: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    settings: {
      get: mocks.settingsGet,
      put: mocks.settingsPut
    }
  }
}))

describe('StorageV2DexieSettingsRecoveryService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('projects a Storage v2 Dexie setting when the legacy setting row is missing', async () => {
    const getSetting = vi.fn().mockResolvedValue(['openai:gpt-4o'])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getSetting
        }
      }
    })
    mocks.settingsGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'pinned:models',
        value: ['openai:gpt-4o']
      })

    const { storageV2DexieSettingsRecoveryService } = await import('../StorageV2DexieSettingsRecoveryService')

    await expect(
      storageV2DexieSettingsRecoveryService.getSetting<string[]>('pinned:models', 'pinned-models-empty')
    ).resolves.toEqual({
      id: 'pinned:models',
      value: ['openai:gpt-4o']
    })

    expect(getSetting).toHaveBeenCalledWith('dexie.settings.pinned:models')
    expect(mocks.settingsPut).toHaveBeenCalledWith({
      id: 'pinned:models',
      value: ['openai:gpt-4o']
    })
  })

  it('does not restore null delete markers as legacy setting rows', async () => {
    const getSetting = vi.fn().mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getSetting
        }
      }
    })
    mocks.settingsGet.mockResolvedValue(undefined)

    const { storageV2DexieSettingsRecoveryService } = await import('../StorageV2DexieSettingsRecoveryService')

    await expect(
      storageV2DexieSettingsRecoveryService.projectSettingIfMissing('image://avatar', 'avatar-missing')
    ).resolves.toBe(false)

    expect(mocks.settingsPut).not.toHaveBeenCalled()
  })
})
