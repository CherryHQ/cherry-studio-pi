import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { buildModelsById } from '../ModelSelectorField'

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'deepseek::deepseek-chat-catalog',
    providerId: 'deepseek',
    apiModelId: 'deepseek-chat',
    name: 'DeepSeek Chat',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('buildModelsById', () => {
  it('resolves stored apiModelId aliases to the catalog model', () => {
    const modelsById = buildModelsById([makeModel()])

    expect(modelsById.get('deepseek::deepseek-chat')?.name).toBe('DeepSeek Chat')
    expect(modelsById.get('deepseek::deepseek-chat-catalog')?.name).toBe('DeepSeek Chat')
  })

  it('keeps an exact model id ahead of another model apiModelId alias', () => {
    const exact = makeModel({
      id: 'deepseek::deepseek-chat',
      apiModelId: 'deepseek-chat',
      name: 'Exact DeepSeek Chat'
    })
    const alias = makeModel({
      id: 'deepseek::deepseek-chat-catalog',
      apiModelId: 'deepseek-chat',
      name: 'Alias DeepSeek Chat'
    })

    const modelsById = buildModelsById([exact, alias])

    expect(modelsById.get('deepseek::deepseek-chat')?.name).toBe('Exact DeepSeek Chat')
  })

  it('derives the provider id from the unique model id for legacy in-memory rows', () => {
    const modelsById = buildModelsById([
      makeModel({
        id: 'deepseek::deepseek-chat-catalog',
        providerId: undefined as unknown as string,
        apiModelId: 'deepseek-chat'
      })
    ])

    expect(modelsById.get('deepseek::deepseek-chat')?.name).toBe('DeepSeek Chat')
  })
})
