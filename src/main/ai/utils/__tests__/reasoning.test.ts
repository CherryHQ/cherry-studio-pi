import { REASONING_EFFORT } from '@cherrystudio/provider-registry'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getGeminiReasoningParams, getReasoningEffort } from '../reasoning'

const createLegacyModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o' as Model['id'],
  providerId: 'openai',
  name: 'gpt-4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

describe('reasoning model id handling', () => {
  it('does not throw for non-reasoning legacy raw model ids', () => {
    const params = getReasoningEffort({ settings: {} } as Assistant, createLegacyModel(), { id: 'openai' } as Provider)

    expect(params).toEqual({})
  })

  it('uses raw legacy Gemini ids when building thinking config', () => {
    const assistant = { settings: { reasoning_effort: REASONING_EFFORT.LOW } } as Assistant
    const model = createLegacyModel({
      id: 'gemini-3-pro-preview' as Model['id'],
      providerId: 'google',
      name: 'gemini-3-pro-preview',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        type: 'gemini',
        supportedEfforts: [REASONING_EFFORT.LOW, REASONING_EFFORT.MEDIUM, REASONING_EFFORT.HIGH],
        thinkingTokenLimits: { min: 0, max: 32768 }
      }
    })

    expect(getGeminiReasoningParams(assistant, model)).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: 'low'
      }
    })
  })
})
