import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentModelFilter } from '../useAgentModelFilter'

const providersMock = vi.hoisted(() => ({
  providers: [] as Array<Record<string, unknown>>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: providersMock.providers })
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    providersMock.providers = [
      {
        id: 'gemini',
        presetProviderId: 'gemini',
        defaultChatEndpoint: 'google-generate-content',
        authType: 'api-key'
      },
      {
        id: 'google-custom',
        presetProviderId: 'gemini',
        defaultChatEndpoint: 'google-generate-content',
        authType: 'api-key'
      },
      {
        id: 'vertex',
        defaultChatEndpoint: 'google-generate-content',
        authType: 'iam-gcp'
      },
      {
        id: 'deepseek',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://api.deepseek.com/anthropic' }
        },
        authType: 'api-key'
      }
    ]
  })

  it('lets Pi agents use every chat-capable provider model', () => {
    const { result } = renderHook(() => useAgentModelFilter('pi'))

    expect(result.current(createModel({ providerId: 'openai' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'deepseek', id: 'deepseek::deepseek-chat' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'gemini', id: 'gemini::gemini-2.5-pro' }))).toBe(true)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
  })

  it('allows chat-capable non-Gemini providers for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(createModel())).toBe(true)
    expect(result.current(createModel({ providerId: 'anthropic', id: 'anthropic::claude-sonnet' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'deepseek', id: 'deepseek::deepseek-chat' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'custom-openai', id: 'custom-openai::gpt-4o' }))).toBe(true)
    expect(result.current(createModel({ providerId: 'vertex', id: 'vertex::gemini-2.5-pro' }))).toBe(true)
  })

  it('filters Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(createModel({ providerId: 'gemini', id: 'gemini::gemini-2.5-pro' }))).toBe(false)
    expect(result.current(createModel({ providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' }))).toBe(
      false
    )
  })

  it('continues to reject non-chat model classes', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.RERANK] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION] }))).toBe(false)
    expect(result.current(createModel({ capabilities: [MODEL_CAPABILITY.VIDEO_GENERATION] }))).toBe(false)
  })
})
