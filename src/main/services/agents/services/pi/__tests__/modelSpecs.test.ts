import type { Model, Provider } from '@types'
import { describe, expect, it } from 'vitest'

import { getModelKeyVariants, normalizeModelKey, resolvePiModelLimits } from '../modelSpecs'

const provider: Provider = {
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  apiKey: 'test',
  apiHost: 'https://api.openai.com/v1',
  models: []
}

describe('Pi model specs', () => {
  it('normalizes provider prefixes and custom deployment wrappers', () => {
    expect(normalizeModelKey('models/openai/GPT_4.1-2025-04-14')).toBe('openai/gpt-4.1-2025-04-14')
    expect(getModelKeyVariants('azure-prod/gpt-4.1-2025-04-14')).toContain('gpt-4.1')
  })

  it('uses model-provided limits before remote catalogs or heuristics', async () => {
    const model: Model = {
      id: 'my-custom-prod-model',
      name: 'Custom model',
      provider: 'openai',
      group: 'custom',
      context_window: 262_144,
      max_input_tokens: 262_144,
      max_output_tokens: 4_096
    }

    const limits = await resolvePiModelLimits(provider, model.id, model)

    expect(limits.contextWindow).toBe(262_144)
    expect(limits.maxTokens).toBe(4_096)
    expect(limits.source).toBe('direct')
    expect(limits.match).toBe('direct')
  })
})
