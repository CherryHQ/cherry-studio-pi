import { cacheService } from '@renderer/data/CacheService'
import { useEffect } from 'react'

export function normalizeAgentSessionRouteSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized || null
}

export function useAgentSessionRouteSeed(value: unknown) {
  const sessionId = normalizeAgentSessionRouteSeed(value)

  useEffect(() => {
    if (!sessionId) return

    cacheService.set('agent.active_session_id', sessionId)
  }, [sessionId])

  return sessionId
}
