import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProvidersMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: useProvidersMock
}))

import { useAgentModelFilter } from '../useAgentModelFilter'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4.1',
    providerId: 'openai',
    name: 'GPT-4.1',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    useProvidersMock.mockReturnValue({
      providers: [
        { id: 'openai', endpointConfigs: {} },
        { id: 'deepseek', endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {} } },
        { id: 'anthropic', endpointConfigs: {} }
      ]
    })
  })

  it('lets Pi agents use every chat-capable provider model', () => {
    const { result } = renderHook(() => useAgentModelFilter('pi'))

    expect(result.current(createModel({ providerId: 'openai' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'deepseek' }))).toBe(true)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
  })

  it('limits Claude SDK agents to native or Anthropic-compatible endpoint providers', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(createModel({ providerId: 'anthropic' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'deepseek', name: 'DeepSeek Chat' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'openai' }))).toBe(false)
    expect(result.current(createModel({ providerId: 'deepseek', capabilities: [MODEL_CAPABILITY.RERANK] }))).toBe(false)
  })
})
