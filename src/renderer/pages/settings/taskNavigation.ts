export const AGENT_SESSION_NAVIGATION_ROUTE = '/app/agents' as const

export function getAgentSessionNavigationTarget(sessionId: string) {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return null

  return {
    to: AGENT_SESSION_NAVIGATION_ROUTE,
    search: { sessionId: normalizedSessionId }
  } as const
}
