import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

export type AgentSessionSelectionItem = Pick<AgentSessionEntity, 'id' | 'agentId'>

export function getFirstUsableAgentSessionId(sessions: readonly AgentSessionSelectionItem[]): string | null {
  return sessions.find((session) => Boolean(session.agentId))?.id ?? null
}

export function resolveFallbackActiveSessionId(
  sessions: readonly AgentSessionSelectionItem[],
  options: { allowOrphan?: boolean } = {}
): string | null {
  return getFirstUsableAgentSessionId(sessions) ?? (options.allowOrphan === false ? null : (sessions[0]?.id ?? null))
}
