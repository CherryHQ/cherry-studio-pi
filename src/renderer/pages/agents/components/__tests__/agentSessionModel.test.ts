import type { Model, UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  createAgentSessionModelFallback,
  resolveAgentSessionModel,
  resolveAgentSessionModelForDisplay
} from '../agentSessionModel'

function makeModel(id: UniqueModelId, apiModelId?: string): Model {
  const providerId = id.split('::')[0]
  return {
    id,
    name: id,
    providerId,
    provider: providerId,
    apiModelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

describe('resolveAgentSessionModel', () => {
  it('resolves exact UniqueModelId matches', () => {
    const model = makeModel('openai::gpt-4o')

    expect(resolveAgentSessionModel('openai::gpt-4o', [model])).toBe(model)
  })

  it('resolves provider models by apiModelId when the stored agent model uses the API id', () => {
    const model = makeModel('deepseek::deepseek-chat-internal', 'deepseek-chat')

    expect(resolveAgentSessionModel('deepseek::deepseek-chat', [model])).toBe(model)
  })

  it('rejects legacy single-colon ids instead of mis-parsing them', () => {
    const model = makeModel('openai::gpt-4o')

    expect(resolveAgentSessionModel('openai:gpt-4o', [model])).toBeUndefined()
  })

  it('resolves legacy raw stored agent models by canonical unique model rows', () => {
    const model = makeModel('openai::gpt-4o')

    expect(resolveAgentSessionModel('gpt-4o', [model])).toBe(model)
  })

  it('resolves trimmed legacy raw stored agent models by apiModelId', () => {
    const model = makeModel('deepseek::deepseek-chat-internal', 'deepseek-chat')

    expect(resolveAgentSessionModel('  deepseek-chat  ', [model])).toBe(model)
  })

  it('resolves legacy raw candidate ids without throwing during chat input render', () => {
    const model = {
      ...makeModel('openai::placeholder'),
      id: 'gpt-4o',
      apiModelId: undefined
    } as unknown as Model

    expect(() => resolveAgentSessionModel('openai::gpt-4o', [model])).not.toThrow()
    expect(resolveAgentSessionModel('openai::gpt-4o', [model])).toBe(model)
  })

  it('still resolves malformed candidate rows when apiModelId is available', () => {
    const model = {
      ...makeModel('deepseek::placeholder'),
      id: 'legacy-deepseek-row',
      apiModelId: 'deepseek-chat'
    } as unknown as Model

    expect(resolveAgentSessionModel('deepseek::deepseek-chat', [model])).toBe(model)
  })
})

describe('agent session model display fallback', () => {
  it('builds a minimal display model from a saved UniqueModelId when the catalog has not refreshed yet', () => {
    const fallback = createAgentSessionModelFallback('deepseek::deepseek-chat')

    expect(fallback).toMatchObject({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat',
      name: 'deepseek-chat',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
  })

  it('prefers a real catalog row over the display fallback', () => {
    const model = makeModel('deepseek::deepseek-chat-internal', 'deepseek-chat')

    expect(resolveAgentSessionModelForDisplay('deepseek::deepseek-chat', [model])).toBe(model)
  })

  it('does not fabricate a provider for legacy raw model ids', () => {
    expect(createAgentSessionModelFallback('deepseek-chat')).toBeUndefined()
  })
})
