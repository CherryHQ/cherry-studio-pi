import type { Assistant, Model, Provider } from '@types'
import { describe, expect, it } from 'vitest'

import {
  summarizeAssistantForLog,
  summarizeMessagesForLog,
  summarizeObjectShapeForLog,
  summarizeProviderConfigForLog,
  summarizeProviderForLog,
  summarizeTextForLog,
  summarizeTextListForLog,
  summarizeUrlForLog
} from '../logging'

describe('aiCore logging summaries', () => {
  it('summarizes provider inputs without secret values or prompts', () => {
    const assistant = {
      id: 'assistant-1',
      name: 'Assistant',
      type: 'assistant',
      prompt: 'raw-system-prompt-secret',
      topics: [],
      settings: {
        customParameters: [{ name: 'apiKey', value: 'raw-custom-param-secret', type: 'string' }]
      }
    } as unknown as Assistant

    const provider = {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      apiKey: 'raw-provider-secret',
      apiHost: 'https://api.example.com/v1?token=raw-url-secret',
      models: [],
      extra_headers: {
        Authorization: 'Bearer raw-header-secret'
      }
    } as Provider

    const summary = {
      assistant: summarizeAssistantForLog(assistant),
      provider: summarizeProviderForLog(provider)
    }
    const serialized = JSON.stringify(summary)

    expect(summary.assistant.hasPrompt).toBe(true)
    expect(summary.provider.hasApiKey).toBe(true)
    expect(summary.provider.extraHeaderKeys).toEqual(['Authorization'])
    expect(serialized).not.toContain('raw-system-prompt-secret')
    expect(serialized).not.toContain('raw-custom-param-secret')
    expect(serialized).not.toContain('raw-provider-secret')
    expect(serialized).not.toContain('raw-url-secret')
    expect(serialized).not.toContain('raw-header-secret')
  })

  it('summarizes provider configs and provider options by shape only', () => {
    const model = {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      group: 'OpenAI'
    } as Model

    const providerConfig = {
      providerId: 'openai-compatible',
      endpoint: 'chat/completions',
      providerSettings: {
        apiKey: 'raw-config-secret',
        baseURL: 'https://api.example.com?token=raw-config-url-secret',
        headers: {
          Authorization: 'Bearer raw-config-header-secret'
        },
        model
      }
    } as any

    const summary = {
      config: summarizeProviderConfigForLog(providerConfig),
      options: summarizeObjectShapeForLog({
        openai: {
          reasoningEffort: 'medium',
          customSecret: 'raw-option-secret'
        }
      })
    }
    const serialized = JSON.stringify(summary)

    expect(serialized).toContain('apiKey')
    expect(serialized).toContain('Authorization')
    expect(serialized).not.toContain('raw-config-secret')
    expect(serialized).not.toContain('raw-config-url-secret')
    expect(serialized).not.toContain('raw-config-header-secret')
    expect(serialized).not.toContain('raw-option-secret')
    expect(serialized).not.toContain('medium')
  })

  it('summarizes text and messages without raw content', () => {
    const textSummary = summarizeTextForLog('private user message')
    const messagesSummary = summarizeMessagesForLog([
      { role: 'user', content: 'raw user content' },
      { role: 'assistant', content: 'raw assistant content' }
    ])
    const serialized = JSON.stringify({ textSummary, messagesSummary })

    expect(textSummary).toMatchObject({
      type: 'string',
      length: 20,
      trimmedLength: 20,
      isEmpty: false
    })
    expect(messagesSummary).toEqual({
      type: 'array',
      length: 2,
      roles: ['user', 'assistant'],
      truncated: false,
      truncatedCount: 0
    })
    expect(serialized).not.toContain('private user message')
    expect(serialized).not.toContain('raw user content')
    expect(serialized).not.toContain('raw assistant content')
  })

  it('summarizes text lists without raw values', () => {
    const summary = summarizeTextListForLog(['secret search question', 'another private value'])
    const serialized = JSON.stringify(summary)

    expect(summary.length).toBe(2)
    expect(summary.truncated).toBe(false)
    expect(serialized).toContain('"length":22')
    expect(serialized).not.toContain('secret search question')
    expect(serialized).not.toContain('another private value')
  })

  it('summarizes circular object shapes without recursing forever', () => {
    const circular: Record<string, unknown> = { id: 'secret-id' }
    circular.self = circular

    const summary = summarizeObjectShapeForLog(circular)
    const serialized = JSON.stringify(summary)

    expect(serialized).toContain('"circular":true')
    expect(serialized).not.toContain('secret-id')
  })

  it('summarizes URLs without leaking path, query, or hash values', () => {
    const summary = summarizeUrlForLog('https://example.com/private/path?token=secret-token#raw-hash')
    const serialized = JSON.stringify(summary)

    expect(summary).toMatchObject({
      type: 'url',
      protocol: 'https:',
      host: 'example.com',
      hasSearch: true,
      hasHash: true
    })
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('raw-hash')
  })
})
