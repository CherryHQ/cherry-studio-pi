import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { hasAnthropicMessagesEndpoint, isSelectableAgentModel } from '../agentModelFilter'

function model(overrides: Partial<Model> = {}): Model {
  return {
    id: 'deepseek-chat',
    providerId: 'deepseek',
    name: 'DeepSeek Chat',
    capabilities: [],
    ...overrides
  } as Model
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKeys: [],
    authType: 'api_key',
    apiFeatures: {},
    settings: {},
    isEnabled: true,
    ...overrides
  } as Provider
}

describe('agentModelFilter', () => {
  it('keeps Pi agents provider-agnostic and only filters out non-chat models', () => {
    const openAiOnlyModel = model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

    expect(isSelectableAgentModel(openAiOnlyModel, 'pi')).toBe(true)
    expect(
      isSelectableAgentModel(
        model({
          id: 'text-embedding-3-large',
          name: 'Embedding',
          capabilities: [MODEL_CAPABILITY.EMBEDDING]
        }),
        'pi'
      )
    ).toBe(false)
  })

  it('accepts Claude SDK models when the provider exposes an Anthropic Messages endpoint', () => {
    const mixedProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.deepseek.com/anthropic' }
      }
    })

    expect(hasAnthropicMessagesEndpoint(model(), mixedProvider)).toBe(true)
    expect(isSelectableAgentModel(model(), 'claude-code', mixedProvider)).toBe(true)
  })

  it('rejects Claude SDK models when neither the model nor provider has an Anthropic Messages endpoint', () => {
    const openAiOnlyProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com/v1' }
      }
    })

    expect(isSelectableAgentModel(model(), 'claude-code', openAiOnlyProvider)).toBe(false)
  })

  it('accepts Claude SDK models with model-level Anthropic endpoint metadata even without provider hydration', () => {
    expect(
      isSelectableAgentModel(
        model({
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        }),
        'claude-code'
      )
    ).toBe(true)
  })

  it('never allows non-chat models through the Claude SDK endpoint gate', () => {
    const anthropicProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.deepseek.com/anthropic' }
      }
    })

    expect(
      isSelectableAgentModel(
        model({
          capabilities: [MODEL_CAPABILITY.RERANK],
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        }),
        'claude-code',
        anthropicProvider
      )
    ).toBe(false)
  })
})
