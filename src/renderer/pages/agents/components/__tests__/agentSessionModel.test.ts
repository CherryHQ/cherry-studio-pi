import type { Model, UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveAgentSessionModel } from '../agentSessionModel'

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

  it('skips malformed candidate ids instead of throwing during chat input render', () => {
    const model = {
      ...makeModel('openai::placeholder'),
      id: 'gpt-4o',
      apiModelId: undefined
    } as unknown as Model

    expect(() => resolveAgentSessionModel('openai::gpt-4o', [model])).not.toThrow()
    expect(resolveAgentSessionModel('openai::gpt-4o', [model])).toBeUndefined()
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
