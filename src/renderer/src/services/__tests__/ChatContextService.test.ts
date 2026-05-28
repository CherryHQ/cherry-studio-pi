import type { Assistant } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

import { applyChatContextBudget } from '../ChatContextService'

vi.mock('../AssistantService', () => ({
  DEFAULT_ASSISTANT_SETTINGS: { contextCount: 10 },
  getAssistantSettings: (assistant: Assistant) => ({
    contextCount: assistant.settings?.contextCount ?? 10,
    maxTokens: assistant.settings?.enableMaxTokens ? assistant.settings?.maxTokens : undefined
  }),
  getDefaultTopic: () => ({
    id: 'topic-default',
    assistantId: 'assistant-default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Default Topic',
    messages: [],
    isNameManuallyEdited: false
  }),
  getDefaultAssistant: () => assistant({ id: 'assistant-default' })
}))

vi.mock('../TokenService', () => ({
  estimateTextTokens: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
  estimateMessageUsage: async (message: Partial<Message>) => ({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: message.usage?.total_tokens ?? 0
  })
}))

function assistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    name: 'Assistant',
    prompt: '',
    topics: [],
    type: 'assistant',
    settings: {},
    model: {
      id: 'tiny-model',
      name: 'tiny-model',
      provider: 'test',
      group: 'test',
      context_window: 140,
      max_output_tokens: 20
    },
    ...overrides
  } as Assistant
}

function message(role: 'user' | 'assistant', id: string, tokens: number): Message {
  return {
    id,
    role,
    topicId: 'topic-1',
    assistantId: 'assistant-1',
    createdAt: new Date().toISOString(),
    status: 'success',
    blocks: [],
    usage: {
      prompt_tokens: role === 'user' ? tokens : 0,
      completion_tokens: role === 'assistant' ? tokens : 0,
      total_tokens: tokens
    }
  } as Message
}

describe('ChatContextService', () => {
  it('keeps a valid recent suffix and drops a leading assistant after budget trimming', async () => {
    const result = await applyChatContextBudget(
      [message('user', 'user-1', 40), message('assistant', 'assistant-1', 40), message('user', 'user-2', 40)],
      assistant()
    )

    expect(result.messages.map((m) => m.id)).toEqual(['user-2'])
    expect(result.stats).toMatchObject({
      budget: 88,
      totalTokens: 40,
      removedMessages: 2
    })
  })

  it('keeps the latest user message even when it is larger than the available budget', async () => {
    const result = await applyChatContextBudget(
      [message('user', 'user-1', 10), message('assistant', 'assistant-1', 10), message('user', 'user-2', 100)],
      assistant({
        model: {
          id: 'tiny-model',
          name: 'tiny-model',
          provider: 'test',
          group: 'test',
          context_window: 90,
          max_output_tokens: 20
        }
      })
    )

    expect(result.messages.map((m) => m.id)).toEqual(['user-2'])
    expect(result.stats.totalTokens).toBe(100)
    expect(result.stats.removedMessages).toBe(2)
  })

  it('uses prompt, output reserve, and input limit to calculate the effective budget', async () => {
    const result = await applyChatContextBudget(
      [message('user', 'user-1', 20), message('assistant', 'assistant-1', 20), message('user', 'user-2', 20)],
      assistant({
        prompt: 'system prompt with a few words',
        model: {
          id: 'input-limited-model',
          name: 'input-limited-model',
          provider: 'test',
          group: 'test',
          max_input_tokens: 90,
          max_output_tokens: 30
        }
      })
    )

    expect(result.stats.budget).toBeLessThan(90)
    expect(result.stats.promptTokens).toBeGreaterThan(0)
    expect(result.stats.limits).toMatchObject({
      maxInputTokens: 90,
      maxOutputTokens: 30,
      source: 'metadata'
    })
  })
})
