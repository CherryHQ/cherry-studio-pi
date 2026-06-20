import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configManager: {
    flushPendingStorageV2ConfigStrict: vi.fn(),
    mirrorAllToStorageV2: vi.fn()
  },
  agentMirror: {
    flushStrict: vi.fn()
  },
  dataApiAgentMirror: {
    flushStrict: vi.fn()
  },
  knowledgeMirror: {
    flushStrict: vi.fn()
  },
  storageV2Service: {
    flushProviderRuntimeMirrors: vi.fn()
  }
}))

vi.mock('../ConfigManager', () => ({
  configManager: mocks.configManager
}))

vi.mock('../storageV2/AgentDbMirrorService', () => ({
  storageV2AgentDbMirrorService: mocks.agentMirror
}))

vi.mock('../storageV2/DataApiAgentRuntimeMirrorService', () => ({
  storageV2DataApiAgentRuntimeMirrorService: mocks.dataApiAgentMirror
}))

vi.mock('../storageV2/KnowledgeMirrorService', () => ({
  storageV2KnowledgeMirrorService: mocks.knowledgeMirror
}))

vi.mock('../storageV2/StorageService', () => ({
  storageV2Service: mocks.storageV2Service
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
    mocks.dataApiAgentMirror.flushStrict.mockResolvedValue(undefined)
    mocks.agentMirror.flushStrict.mockResolvedValue(undefined)
    mocks.knowledgeMirror.flushStrict.mockResolvedValue({ baseCount: 0, itemCount: 0 })
    mocks.storageV2Service.flushProviderRuntimeMirrors.mockResolvedValue({ mirroredCount: 0 })
  })

  it('strictly flushes main runtime mirrors in order', async () => {
    const { flushMainStorageV2RuntimeMirrors } = await import('../AppRuntimeSaveService')

    await flushMainStorageV2RuntimeMirrors()

    expect(mocks.configManager.flushPendingStorageV2ConfigStrict).toHaveBeenCalledTimes(1)
    expect(mocks.configManager.mirrorAllToStorageV2).toHaveBeenCalledTimes(1)
    expect(mocks.storageV2Service.flushProviderRuntimeMirrors).toHaveBeenCalledTimes(1)
    expect(mocks.dataApiAgentMirror.flushStrict).toHaveBeenCalledTimes(1)
    expect(mocks.agentMirror.flushStrict).toHaveBeenCalledTimes(1)
    expect(mocks.knowledgeMirror.flushStrict).toHaveBeenCalledTimes(1)
    expect(mocks.configManager.flushPendingStorageV2ConfigStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.configManager.mirrorAllToStorageV2.mock.invocationCallOrder[0]
    )
    expect(mocks.configManager.mirrorAllToStorageV2.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storageV2Service.flushProviderRuntimeMirrors.mock.invocationCallOrder[0]
    )
    expect(mocks.storageV2Service.flushProviderRuntimeMirrors.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dataApiAgentMirror.flushStrict.mock.invocationCallOrder[0]
    )
    expect(mocks.dataApiAgentMirror.flushStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.agentMirror.flushStrict.mock.invocationCallOrder[0]
    )
    expect(mocks.agentMirror.flushStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.knowledgeMirror.flushStrict.mock.invocationCallOrder[0]
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
