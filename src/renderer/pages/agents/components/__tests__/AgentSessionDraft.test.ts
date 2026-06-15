import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_SESSION_DRAFT_CACHE_TTL,
  type AgentSessionDraftCache,
  getAgentSessionDraftCacheKey,
  getLegacyAgentDraftCacheKey,
  readInitialAgentSessionDraft
} from '../AgentSessionDraft'

function createCache(values: Record<string, string | undefined>): AgentSessionDraftCache {
  return {
    getCasual<T>(key: string) {
      return values[key] as T | undefined
    },
    setCasual: vi.fn(),
    deleteCasual: vi.fn(() => true)
  }
}

describe('AgentSessionDraft', () => {
  it('uses session-scoped keys so sessions for the same agent do not share drafts', () => {
    expect(getAgentSessionDraftCacheKey('agent-1', 'session-a')).toBe('agent-session-draft-agent-1-session-a')
    expect(getAgentSessionDraftCacheKey('agent-1', 'session-b')).toBe('agent-session-draft-agent-1-session-b')
    expect(getLegacyAgentDraftCacheKey('agent-1')).toBe('agent-session-draft-agent-1')
  })

  it('prefers an existing session draft over the legacy agent-level draft', () => {
    const cache = createCache({
      [getAgentSessionDraftCacheKey('agent-1', 'session-a')]: 'session draft',
      [getLegacyAgentDraftCacheKey('agent-1')]: 'legacy draft'
    })

    expect(readInitialAgentSessionDraft(cache, 'agent-1', 'session-a')).toBe('session draft')
    expect(cache.setCasual).not.toHaveBeenCalled()
    expect(cache.deleteCasual).not.toHaveBeenCalled()
  })

  it('migrates a legacy agent-level draft to the active session once', () => {
    const cache = createCache({
      [getLegacyAgentDraftCacheKey('agent-1')]: 'legacy draft'
    })

    expect(readInitialAgentSessionDraft(cache, 'agent-1', 'session-a')).toBe('legacy draft')
    expect(cache.setCasual).toHaveBeenCalledWith(
      getAgentSessionDraftCacheKey('agent-1', 'session-a'),
      'legacy draft',
      AGENT_SESSION_DRAFT_CACHE_TTL
    )
    expect(cache.deleteCasual).toHaveBeenCalledWith(getLegacyAgentDraftCacheKey('agent-1'))
  })
})
