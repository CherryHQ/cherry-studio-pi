import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteSettingAndFlush: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  convertToBase64: vi.fn()
}))

vi.mock('../StorageV2DexieSettingsMirrorService', () => ({
  storageV2DexieSettingsMirrorService: {
    deleteSettingAndFlush: mocks.deleteSettingAndFlush
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
    mocks.deleteSettingAndFlush.mockResolvedValue(undefined)
  })

  it('deletes the legacy image setting through the strict Storage v2 mirror helper', async () => {
    const { default: ImageStorage } = await import('../ImageStorage')

    await ImageStorage.remove('avatar')

    expect(mocks.deleteSettingAndFlush).toHaveBeenCalledWith('image://avatar', { strict: true })
  })
})
