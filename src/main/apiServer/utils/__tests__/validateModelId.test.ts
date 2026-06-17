import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getByKey: vi.fn(),
  listModels: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: mocks.getByProviderId }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getByKey, list: mocks.listModels }
}))

const { validateModelId } = await import('../index')

describe('validateModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getByProviderId.mockResolvedValue({
      id: 'deepseek',
      name: 'DeepSeek',
      isEnabled: true,
      apiKeys: [],
      authType: 'api-key',
      apiFeatures: {},
      settings: {}
    })
    mocks.getByKey.mockResolvedValue({
      id: 'deepseek::deepseek-v4-flash',
      providerId: 'deepseek',
      apiModelId: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
    mocks.listModels.mockResolvedValue([])
  })

  it('parses storage-v2 UniqueModelId with the double-colon separator', async () => {
    const result = await validateModelId('deepseek::deepseek-v4-flash')

    expect(result).toMatchObject({
      valid: true,
      modelId: 'deepseek-v4-flash',
      provider: { id: 'deepseek' },
      model: { id: 'deepseek::deepseek-v4-flash' }
    })
    expect(mocks.getByProviderId).toHaveBeenCalledWith('deepseek')
    expect(mocks.getByKey).toHaveBeenCalledWith('deepseek', 'deepseek-v4-flash')
    expect(mocks.listModels).not.toHaveBeenCalled()
  })

  it('falls back to provider apiModelId aliases and returns the runtime API id', async () => {
    mocks.getByKey.mockRejectedValueOnce(new Error('not found'))
    mocks.listModels.mockResolvedValueOnce([
      {
        id: 'deepseek::deepseek-chat',
        providerId: 'deepseek',
        apiModelId: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }
    ])

    const result = await validateModelId('deepseek::deepseek-v4-flash')

    expect(result).toMatchObject({
      valid: true,
      modelId: 'deepseek-v4-flash',
      provider: { id: 'deepseek' },
      model: { id: 'deepseek::deepseek-chat', apiModelId: 'deepseek-v4-flash' }
    })
    expect(mocks.getByKey).toHaveBeenCalledWith('deepseek', 'deepseek-v4-flash')
    expect(mocks.listModels).toHaveBeenCalledWith({ providerId: 'deepseek' })
  })

  it('returns the model apiModelId even when the stored unique id is canonical', async () => {
    mocks.getByKey.mockResolvedValueOnce({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    const result = await validateModelId('deepseek::deepseek-chat')

    expect(result).toMatchObject({
      valid: true,
      modelId: 'deepseek-v4-flash',
      model: { id: 'deepseek::deepseek-chat' }
    })
    expect(mocks.listModels).not.toHaveBeenCalled()
  })

  it('rejects the legacy single-colon format so callers do not silently route to a wrong model id', async () => {
    const result = await validateModelId('deepseek:deepseek-v4-flash')

    expect(result.valid).toBe(false)
    expect(result.error).toMatchObject({ type: 'invalid_format', code: 'invalid_model_format' })
    expect(mocks.getByProviderId).not.toHaveBeenCalled()
    expect(mocks.getByKey).not.toHaveBeenCalled()
    expect(mocks.listModels).not.toHaveBeenCalled()
  })
})
