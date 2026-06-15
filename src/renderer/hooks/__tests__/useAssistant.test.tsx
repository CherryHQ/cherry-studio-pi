import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  composeDefaultAssistant,
  resolveDefaultAssistantOption,
  useAssistant,
  useDefaultAssistant
} from '../useAssistant'

function queryResult(data?: unknown) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn().mockResolvedValue(data),
    mutate: vi.fn().mockResolvedValue(data)
  } as never
}

describe('useDefaultAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('returns an assistant with the sentinel default id', () => {
    const { result } = renderHook(() => useDefaultAssistant())
    expect(result.current.assistant.id).toBe(DEFAULT_ASSISTANT_ID)
  })

  it('reflects the chat.default_model_id preference in assistant.modelId', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBe('openai::gpt-4o')
  })

  it('returns null modelId when preference is unset', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBeNull()
  })

  it('always returns a defined assistant — no loading state', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant).toBeDefined()
    expect(result.current.assistant.settings).toBeDefined()
    expect(result.current.assistant.mcpServerIds).toEqual([])
    expect(result.current.assistant.knowledgeBaseIds).toEqual([])
  })
})

describe('resolveDefaultAssistantOption', () => {
  it('uses the seeded default assistant instead of the renderer sentinel when present', () => {
    const fallback = composeDefaultAssistant(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    const seeded = {
      ...fallback,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Default Assistant',
      modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    }

    expect(resolveDefaultAssistantOption([seeded], fallback)).toBe(seeded)
  })
})

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    mockUseQuery.mockImplementation((_path, options) => (options?.enabled === false ? queryResult() : queryResult()))
    vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        ...window.toast,
        error: vi.fn()
      }
    })
  })

  it('disables the DataApi query when id is null', () => {
    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('disables the DataApi query when id is undefined', () => {
    renderHook(() => useAssistant(undefined))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('returns assistant: undefined for a topic without an assistant', () => {
    const { result } = renderHook(() => useAssistant(null))

    expect(result.current.assistant).toBeUndefined()
  })

  it('uses the default model only when the topic has no persisted assistant', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')

    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/models/provider::default-model', {
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('persists model changes to the default model preference when the topic has no assistant', async () => {
    const nextModel = {
      id: 'openai::gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      providerId: 'openai'
    }

    const { result } = renderHook(() => useAssistant(null))

    await act(async () => {
      await result.current.setModel(nextModel as never)
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBe('openai::gpt-4o')
  })

  it('does not fall back to the default model when a persisted assistant has no model', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/assistants/:id') {
        return queryResult({
          id: 'assistant-1',
          name: 'Assistant 1',
          modelId: null,
          settings: {},
          mcpServerIds: [],
          knowledgeBaseIds: []
        })
      }
      if (String(path).startsWith('/models/provider::default-model')) {
        return queryResult({ id: 'provider::default-model', name: 'Default Model' })
      }
      return queryResult()
    })

    const { result } = renderHook(() => useAssistant('assistant-1'))

    expect(result.current.assistant).toBeDefined()
    expect(result.current.model).toBeUndefined()
    expect(mockUseQuery).toHaveBeenCalledWith('/models/', {
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('disables previous data for assistant identity switches', () => {
    renderHook(() => useAssistant('assistant-new'))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: 'assistant-new' },
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('shows an error toast when quick assistant settings persistence fails', async () => {
    const assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      modelId: null,
      settings: {},
      mcpServerIds: [],
      knowledgeBaseIds: []
    }
    const patchTrigger = vi.fn().mockRejectedValue(new Error('persist failed'))

    MockUseDataApiUtils.mockQueryResult('/assistants/:id', { data: assistant as never })
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/assistants/:id', patchTrigger)

    const { result } = renderHook(() => useAssistant('assistant-1'))

    await act(async () => {
      await result.current.updateAssistantSettings({ enableWebSearch: true })
    })

    expect(patchTrigger).toHaveBeenCalledWith({
      params: { id: 'assistant-1' },
      body: { settings: { enableWebSearch: true } }
    })
    expect(window.toast.error).toHaveBeenCalledWith(expect.stringContaining('persist failed'))
  })

  it('shows an error toast when quick assistant model persistence fails', async () => {
    const assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      modelId: null,
      settings: { enableWebSearch: false },
      mcpServerIds: [],
      knowledgeBaseIds: []
    }
    const nextModel = {
      id: 'openai::gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      providerId: 'openai'
    }
    const patchTrigger = vi.fn().mockRejectedValue(new Error('model persist failed'))

    MockUseDataApiUtils.mockQueryResult('/assistants/:id', { data: assistant as never })
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/assistants/:id', patchTrigger)

    const { result } = renderHook(() => useAssistant('assistant-1'))

    await act(async () => {
      await result.current.setModel(nextModel as never)
    })

    expect(patchTrigger).toHaveBeenCalledWith({
      params: { id: 'assistant-1' },
      body: { modelId: 'openai::gpt-4o' }
    })
    expect(window.toast.error).toHaveBeenCalledWith(expect.stringContaining('model persist failed'))
  })
})
