import { describe, expect, it } from 'vitest'

import { isSessionAgentMissing } from '../AgentChat'

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
