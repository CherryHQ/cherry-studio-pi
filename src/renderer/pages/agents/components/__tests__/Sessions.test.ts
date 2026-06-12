import { describe, expect, it } from 'vitest'

import { resolveCreateSessionAgentId } from '../Sessions'

describe('resolveCreateSessionAgentId', () => {
  const sessions = [
    { id: 'session-1', agentId: 'agent-1' },
    { id: 'session-2', agentId: 'agent-2' }
  ]
  const agents = [{ id: 'agent-a' }, { id: 'agent-b' }]

  it('prefers the agent that owns the active session', () => {
    expect(resolveCreateSessionAgentId(sessions, 'session-2', agents)).toBe('agent-2')
  })

  it('falls back to the first session owner when the active session is missing', () => {
    expect(resolveCreateSessionAgentId(sessions, 'missing-session', agents)).toBe('agent-1')
  })

  it('falls back to the first agent when no sessions exist yet', () => {
    expect(resolveCreateSessionAgentId([], null, agents)).toBe('agent-a')
  })

  it('returns null only when there are no sessions and no agents', () => {
    expect(resolveCreateSessionAgentId([], null, [])).toBeNull()
  })
})
