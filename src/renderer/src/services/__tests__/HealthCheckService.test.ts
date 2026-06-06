import type { Model, Provider } from '@renderer/types'
import { HealthStatus } from '@renderer/types/healthCheck'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkModel: vi.fn()
}))

vi.mock('../ApiService', () => ({
  checkModel: mocks.checkModel
}))

const provider = {
  id: 'provider-1',
  name: 'Provider',
  type: 'openai',
  apiKey: 'default-key'
} as Provider

const models = [
  { id: 'model-1', name: 'Model 1', provider: 'provider-1' },
  { id: 'model-2', name: 'Model 2', provider: 'provider-1' }
] as Model[]

describe('HealthCheckService', () => {
  it('checks models sequentially when concurrent mode is disabled', async () => {
    const events: string[] = []

    mocks.checkModel.mockImplementation(async (_provider: Provider, model: Model) => {
      events.push(`start:${model.id}`)
      await Promise.resolve()
      events.push(`end:${model.id}`)
    })

    const { checkModelsHealth } = await import('../HealthCheckService')
    const checked: Array<{ modelId: string; index: number }> = []

    const results = await checkModelsHealth(
      {
        provider,
        models,
        apiKeys: ['key-1'],
        isConcurrent: false
      },
      (result, index) => checked.push({ modelId: result.model.id, index })
    )

    expect(events).toEqual(['start:model-1', 'end:model-1', 'start:model-2', 'end:model-2'])
    expect(checked).toEqual([
      { modelId: 'model-1', index: 0 },
      { modelId: 'model-2', index: 1 }
    ])
    expect(results.map((result) => result.status)).toEqual([HealthStatus.SUCCESS, HealthStatus.SUCCESS])
  })

  it('starts model checks together when concurrent mode is enabled', async () => {
    const events: string[] = []

    mocks.checkModel.mockImplementation(async (_provider: Provider, model: Model) => {
      events.push(`start:${model.id}`)
      await Promise.resolve()
      events.push(`end:${model.id}`)
    })

    const { checkModelsHealth } = await import('../HealthCheckService')

    await checkModelsHealth({
      provider,
      models,
      apiKeys: ['key-1'],
      isConcurrent: true
    })

    expect(events.slice(0, 2)).toEqual(['start:model-1', 'start:model-2'])
    expect(events).toEqual(['start:model-1', 'start:model-2', 'end:model-1', 'end:model-2'])
  })
})
