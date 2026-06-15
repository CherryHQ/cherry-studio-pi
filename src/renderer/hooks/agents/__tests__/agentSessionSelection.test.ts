import { describe, expect, it } from 'vitest'

import { getFirstUsableAgentSessionId, resolveFallbackActiveSessionId } from '../agentSessionSelection'

describe('agentSessionSelection', () => {
  const sessions = [
    { id: 'orphan-session', agentId: null },
    { id: 'usable-session', agentId: 'agent-1' }
  ]

  it('returns the first session that still has an agent', () => {
    expect(getFirstUsableAgentSessionId(sessions)).toBe('usable-session')
  })

  it('falls back to an orphan session only when allowed', () => {
    expect(resolveFallbackActiveSessionId([{ id: 'orphan-session', agentId: null }])).toBe('orphan-session')
    expect(resolveFallbackActiveSessionId([{ id: 'orphan-session', agentId: null }], { allowOrphan: false })).toBeNull()
  })

  it('prefers usable sessions over earlier orphan sessions', () => {
    expect(resolveFallbackActiveSessionId(sessions)).toBe('usable-session')
  })
})
