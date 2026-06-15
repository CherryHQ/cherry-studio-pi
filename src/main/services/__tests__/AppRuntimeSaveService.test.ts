import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configManager: {
    flushPendingStorageV2ConfigStrict: vi.fn(),
    mirrorAllToStorageV2: vi.fn()
  },
  mirror: {
    flushStrict: vi.fn()
  }
}))

vi.mock('../ConfigManager', () => ({
  configManager: mocks.configManager
}))

vi.mock('../storageV2/AgentDbMirrorService', () => ({
  storageV2AgentDbMirrorService: mocks.mirror
}))

function createWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 10,
      send: vi.fn()
    }
  } as any
}

describe('AppRuntimeSaveService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configManager.flushPendingStorageV2ConfigStrict.mockResolvedValue(undefined)
    mocks.configManager.mirrorAllToStorageV2.mockResolvedValue(undefined)
    mocks.mirror.flushStrict.mockResolvedValue(undefined)
  })

  it('strictly flushes main runtime mirrors in order', async () => {
    const { flushMainStorageV2RuntimeMirrors } = await import('../AppRuntimeSaveService')

    await flushMainStorageV2RuntimeMirrors()

    expect(mocks.configManager.flushPendingStorageV2ConfigStrict).toHaveBeenCalledTimes(1)
    expect(mocks.configManager.mirrorAllToStorageV2).toHaveBeenCalledTimes(1)
    expect(mocks.mirror.flushStrict).toHaveBeenCalledTimes(1)
    expect(mocks.configManager.flushPendingStorageV2ConfigStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.configManager.mirrorAllToStorageV2.mock.invocationCallOrder[0]
    )
    expect(mocks.configManager.mirrorAllToStorageV2.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mirror.flushStrict.mock.invocationCallOrder[0]
    )
  })

  it('keeps renderer save data as a fast no-op after v2 persistence migration', async () => {
    const { requestRendererSaveData } = await import('../AppRuntimeSaveService')
    const window = createWindow()

    await expect(requestRendererSaveData(window, 1)).resolves.toBe(false)

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('reports main flush failures without waiting for a renderer ack', async () => {
    const { flushAppRuntimeData } = await import('../AppRuntimeSaveService')
    mocks.configManager.flushPendingStorageV2ConfigStrict.mockRejectedValueOnce(new Error('config locked'))
    const window = createWindow()

    await expect(flushAppRuntimeData({ window })).rejects.toThrow('config locked')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
