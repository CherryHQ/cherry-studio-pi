import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { isSessionAgentMissing, resolveAgentModelSnapshot } from '../AgentChat'

describe('isSessionAgentMissing', () => {
  it('does not report a missing agent while the agent query is still loading', () => {
    expect(isSessionAgentMissing({ agentId: 'agent-1' }, undefined, true)).toBe(false)
  })

  it('reports a missing agent when the session points to an agent that cannot be resolved', () => {
    expect(isSessionAgentMissing({ agentId: 'agent-1' }, undefined, false)).toBe(true)
  })

  it('does not report a missing agent when the session has no agent id', () => {
    expect(isSessionAgentMissing({ agentId: null }, undefined, false)).toBe(false)
  })

  it('does not report a missing agent when the agent is resolved', () => {
    expect(isSessionAgentMissing({ agentId: 'agent-1' }, { id: 'agent-1' }, false)).toBe(false)
  })
})

describe('resolveAgentModelSnapshot', () => {
  it('uses the resolved model display name while keeping the API raw model id', () => {
    const model = {
      id: 'deepseek::deepseek-chat-internal',
      providerId: 'deepseek',
      provider: 'deepseek',
      apiModelId: 'deepseek-chat',
      name: 'DeepSeek Chat',
      group: 'chat',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model

    expect(resolveAgentModelSnapshot('deepseek::deepseek-chat', [model])).toEqual({
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'deepseek',
      group: 'chat'
    })
  })

  it('falls back to the encoded model id when the model is missing locally', () => {
    expect(resolveAgentModelSnapshot('openai::gpt-4.1', [])).toEqual({
      id: 'gpt-4.1',
      name: 'gpt-4.1',
      provider: 'openai'
    })
  })
})
