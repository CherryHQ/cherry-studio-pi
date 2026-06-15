import { createUniqueModelId, type Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { createModelSnapshot } from '../modelSnapshot'

function model(overrides: Partial<Model>): Model {
  return {
    id: createUniqueModelId('openai', 'gpt-4o'),
    providerId: 'openai',
    name: 'GPT-4o',
    apiModelId: undefined,
    isEnabled: true,
    isHidden: false,
    orderKey: 'a0',
    ...overrides
  } as Model
}

describe('createModelSnapshot', () => {
  it('uses apiModelId when present', () => {
    expect(
      createModelSnapshot(
        model({
          id: createUniqueModelId('openai', 'gpt-4o'),
          apiModelId: 'gpt-4o-2024-11-20'
        })
      )
    ).toEqual({
      id: 'gpt-4o-2024-11-20',
      name: 'GPT-4o',
      provider: 'openai'
    })
  })

  it('falls back to the raw model id from a UniqueModelId', () => {
    expect(
      createModelSnapshot(
        model({
          id: createUniqueModelId('anthropic', 'claude-sonnet-4-5'),
          providerId: 'anthropic',
          name: 'Claude Sonnet 4.5'
        })
      )
    ).toEqual({
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      provider: 'anthropic'
    })
  })

  it('tolerates legacy raw model ids without throwing', () => {
    expect(
      createModelSnapshot(
        model({
          id: 'gpt-4o' as Model['id'],
          apiModelId: undefined,
          providerId: 'openai',
          name: 'GPT-4o'
        })
      )
    ).toEqual({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai'
    })
  })

  it('ignores blank apiModelId values', () => {
    expect(
      createModelSnapshot(
        model({
          id: createUniqueModelId('deepseek', 'deepseek-chat'),
          apiModelId: '   ',
          providerId: 'deepseek',
          name: 'DeepSeek Chat'
        })
      )
    ).toEqual({
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'deepseek'
    })
  })
})
