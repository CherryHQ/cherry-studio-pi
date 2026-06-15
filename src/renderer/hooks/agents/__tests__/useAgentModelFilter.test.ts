import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentModelFilter } from '../useAgentModelFilter'

const { providerFixtures } = vi.hoisted(() => ({
  providerFixtures: [] as Provider[]
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    providers: providerFixtures
  })
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4.1',
    providerId: 'openai',
    name: 'GPT 4.1',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    isEnabled: true,
    supportsStreaming: true,
    ...overrides
  } as Model
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    isEnabled: true,
    type: 'openai',
    apiKey: '',
    apiHost: '',
    models: [],
    endpointConfigs: {},
    ...overrides
  } as Provider
}

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    providerFixtures.length = 0
  })

  it('allows any chat model for Pi agents and rejects non-chat capabilities', () => {
    const { result } = renderHook(() => useAgentModelFilter('pi'))

    expect(result.current(createModel())).toBe(true)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.RERANK] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] }))).toBe(false)
  })

  it('uses the same Anthropic-compatible model rules as agent creation for Claude SDK agents', () => {
    providerFixtures.push(
      createProvider({
        id: 'deepseek',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      }),
      createProvider({
        id: 'siliconflow',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.siliconflow.cn/anthropic' }
        }
      }),
      createProvider({
        id: 'openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
        }
      })
    )
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(
      result.current(
        createModel({
          id: 'deepseek::deepseek-chat',
          providerId: 'deepseek',
          endpointTypes: undefined
        })
      )
    ).toBe(true)
    expect(
      result.current(
        createModel({
          id: 'siliconflow::qwen3-coder',
          providerId: 'siliconflow',
          endpointTypes: undefined
        })
      )
    ).toBe(true)
    expect(
      result.current(
        createModel({
          id: 'custom::claude-compatible',
          providerId: 'custom',
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        })
      )
    ).toBe(true)
    expect(
      result.current(
        createModel({
          id: 'openai::gpt-4.1',
          providerId: 'openai',
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        })
      )
    ).toBe(false)
  })
})
