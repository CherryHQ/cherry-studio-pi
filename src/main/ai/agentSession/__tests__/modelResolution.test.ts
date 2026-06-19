import type { Model } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getByKey: vi.fn(),
  list: vi.fn(),
  resolveModels: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: mocks.getByKey,
    list: mocks.list
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    resolveModels: mocks.resolveModels
  }
}))

import { resolveAgentRuntimeModel } from '../modelResolution'

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'provider::model',
    providerId: 'provider',
    name: 'Model',
    capabilities: [],
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('resolveAgentRuntimeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getByKey.mockRejectedValue(new Error('model not found by key'))
    mocks.list.mockResolvedValue([])
    mocks.resolveModels.mockResolvedValue([])
  })

  it('returns a registered unique model without consulting the provider registry', async () => {
    const registered = makeModel({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat'
    })
    mocks.getByKey.mockResolvedValueOnce(registered)

    await expect(resolveAgentRuntimeModel({ id: 'agent-1', model: 'deepseek::deepseek-chat' })).resolves.toBe(
      registered
    )

    expect(mocks.resolveModels).not.toHaveBeenCalled()
  })

  it('falls back to the provider registry when the exact model row is missing but the provider has other models', async () => {
    const registryModel = makeModel({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat'
    })
    mocks.list.mockResolvedValueOnce([
      makeModel({
        id: 'deepseek::deepseek-reasoner',
        providerId: 'deepseek',
        apiModelId: 'deepseek-reasoner'
      })
    ])
    mocks.resolveModels.mockResolvedValueOnce([registryModel])

    await expect(resolveAgentRuntimeModel({ id: 'agent-1', model: 'deepseek::deepseek-chat' })).resolves.toBe(
      registryModel
    )

    expect(mocks.resolveModels).toHaveBeenCalledWith('deepseek', ['deepseek-chat'])
  })

  it('still reports a missing model when neither user models nor the provider registry can resolve it', async () => {
    mocks.list.mockResolvedValueOnce([
      makeModel({
        id: 'deepseek::deepseek-reasoner',
        providerId: 'deepseek',
        apiModelId: 'deepseek-reasoner'
      })
    ])
    mocks.resolveModels.mockResolvedValueOnce([])

    await expect(resolveAgentRuntimeModel({ id: 'agent-1', model: 'deepseek::missing-model' })).rejects.toThrow(
      'Agent agent-1 model "deepseek::missing-model" is not registered in user_model'
    )
  })
})
