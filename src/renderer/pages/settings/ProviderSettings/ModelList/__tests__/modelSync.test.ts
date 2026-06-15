import type { Model } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels, toCreateModelDto } from '../modelSync'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn()
  }
}))

const listModelsMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Stub the Electron preload bridge surface used by modelSync.
  ;(globalThis as any).window = {
    api: {
      ai: {
        listModels: listModelsMock
      }
    }
  }
  listModelsMock.mockResolvedValue([])
})

describe('fetchResolvedProviderModels', () => {
  it('throws when upstream model listing fails instead of returning an empty list', async () => {
    listModelsMock.mockRejectedValueOnce(new Error('upstream failed'))

    await expect(fetchResolvedProviderModels('openai')).rejects.toThrow('upstream failed')

    expect(listModelsMock).toHaveBeenCalledWith({
      providerId: 'openai',
      throwOnError: true
    })
  })

  it('creates model DTOs from raw legacy model ids without throwing', () => {
    const model = {
      id: 'legacy-provider-model',
      providerId: 'openai',
      apiModelId: undefined,
      name: 'Legacy Provider Model',
      group: 'Custom',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as unknown as Model

    expect(toCreateModelDto('openai', model)).toMatchObject({
      providerId: 'openai',
      modelId: 'legacy-provider-model',
      name: 'Legacy Provider Model',
      group: 'Custom'
    })
  })
})
