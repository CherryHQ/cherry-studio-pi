import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteSetting: vi.fn(),
  flushStrict: vi.fn(),
  scheduleDelete: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    settings: {
      delete: mocks.deleteSetting
    }
  }
}))

vi.mock('@renderer/utils', () => ({
  convertToBase64: vi.fn()
}))

vi.mock('../StorageV2DexieSettingsMirrorService', () => ({
  storageV2DexieSettingsMirrorService: {
    flushStrict: mocks.flushStrict,
    scheduleDelete: mocks.scheduleDelete
  }
}))

vi.mock('../StorageV2DexieSettingsRecoveryService', () => ({
  storageV2DexieSettingsRecoveryService: {
    getSetting: vi.fn()
  }
}))

describe('ImageStorage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.flushStrict.mockResolvedValue(undefined)
    mocks.deleteSetting.mockResolvedValue(undefined)
  })

  it('writes the Storage v2 image tombstone before deleting the legacy setting', async () => {
    const { default: ImageStorage } = await import('../ImageStorage')

    await ImageStorage.remove('avatar')

    expect(mocks.scheduleDelete).toHaveBeenCalledWith('image://avatar')
    expect(mocks.flushStrict).toHaveBeenCalled()
    expect(mocks.deleteSetting).toHaveBeenCalledWith('image://avatar')
    expect(mocks.flushStrict.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteSetting.mock.invocationCallOrder[0])
  })
})
