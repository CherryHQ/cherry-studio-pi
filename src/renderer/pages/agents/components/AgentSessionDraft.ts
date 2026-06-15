export const AGENT_SESSION_DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface AgentSessionDraftCache {
  getCasual<T>(key: string): T | undefined
  setCasual<T>(key: string, value: T, ttl?: number): void
  deleteCasual(key: string): boolean
}

export const getLegacyAgentDraftCacheKey = (agentId: string) => `agent-session-draft-${agentId}`

export const getAgentSessionDraftCacheKey = (agentId: string, sessionId: string) =>
  `agent-session-draft-${agentId}-${sessionId}`

export function readInitialAgentSessionDraft(
  cache: AgentSessionDraftCache,
  agentId: string,
  sessionId: string,
  ttl = AGENT_SESSION_DRAFT_CACHE_TTL
): string {
  const draftKey = getAgentSessionDraftCacheKey(agentId, sessionId)
  const sessionDraft = cache.getCasual<string>(draftKey)
  if (sessionDraft !== undefined) {
    return sessionDraft
  }

  const legacyKey = getLegacyAgentDraftCacheKey(agentId)
  const legacyDraft = cache.getCasual<string>(legacyKey)
  if (legacyDraft === undefined) {
    return ''
  }

  if (legacyDraft.length > 0) {
    cache.setCasual(draftKey, legacyDraft, ttl)
  }
  cache.deleteCasual(legacyKey)
  return legacyDraft
}
