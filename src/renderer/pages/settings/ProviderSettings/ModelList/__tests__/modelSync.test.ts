import type { Model } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels, toCreateModelDto } from '../modelSync'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn()
  }
}))

// listModels goes through ipcApi.request('ai.list_models', …) now (Main IPC).
const { listModelsMock } = vi.hoisted(() => ({ listModelsMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => listModelsMock(input) }
}))

beforeEach(() => {
  vi.clearAllMocks()
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
