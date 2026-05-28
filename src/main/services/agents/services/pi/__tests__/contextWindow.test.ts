import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import { buildContextWindowBudget, estimateTextTokens, trimMessagesToBudget } from '../contextWindow'

const makeTool = (): AgentTool<any> => ({
  name: 'Read',
  label: 'Read',
  description: 'Read a file',
  parameters: { type: 'object', properties: {} } as any,
  execute: async () => ({ content: [{ type: 'text', text: '' }], details: {} })
})

describe('Pi context window management', () => {
  it('estimates CJK text more conservatively than ASCII text', () => {
    expect(estimateTextTokens('hello world'.repeat(20))).toBeLessThan(estimateTextTokens('你好世界'.repeat(20)))
  })

  it('keeps the latest user turn while trimming older messages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'old '.repeat(400), timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'old answer '.repeat(400) }],
        api: 'openai-completions',
        provider: 'test',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: 2
      },
      { role: 'user', content: 'current request', timestamp: 3 }
    ]
    const budget = buildContextWindowBudget({
      contextWindow: 5_000,
      maxTokens: 1_024,
      systemPrompt: '',
      tools: [makeTool()]
    })
    const trimmed = trimMessagesToBudget(messages, { ...budget, inputBudget: 20 })

    expect(trimmed).toHaveLength(1)
    expect(trimmed[0]).toMatchObject({ role: 'user', content: 'current request' })
  })

  it('keeps a user, assistant tool-call, and tool-result group together', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'old '.repeat(400), timestamp: 1 },
      { role: 'user', content: 'inspect package', timestamp: 2 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'Read', arguments: { path: 'package.json' } }],
        api: 'openai-completions',
        provider: 'test',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 3
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'Read',
        content: [{ type: 'text', text: '{"name":"demo"}' }],
        isError: false,
        timestamp: 4
      }
    ]
    const budget = buildContextWindowBudget({
      contextWindow: 5_000,
      maxTokens: 1_024,
      systemPrompt: '',
      tools: [makeTool()]
    })
    const trimmed = trimMessagesToBudget(messages, { ...budget, inputBudget: 30 })

    expect(trimmed.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult'])
    expect(trimmed[0]).toMatchObject({ role: 'user', content: 'inspect package' })
  })
})
