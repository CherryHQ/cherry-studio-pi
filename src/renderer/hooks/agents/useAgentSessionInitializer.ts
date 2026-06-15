import { useQuery } from '@data/hooks/useDataApi'
import { useCache } from '@renderer/data/hooks/useCache'
import { useEffect } from 'react'

import { resolveFallbackActiveSessionId } from './agentSessionSelection'

const FALLBACK_SESSION_SCAN_LIMIT = 200

/**
 * On startup, if no active session is set, pick the most-recently-ordered one
 * and seed `agent.active_session_id`. The list endpoint already returns
 * sessions sorted by `(orderKey, id)` ASC and `createSession` inserts at
 * position `'first'`, so the first item is what the user touched most
 * recently (or the first pinned one — pinning floats above otherwise).
 *
 * Read via `useQuery` (SWR-deduped) instead of a raw `dataApiService.get`
 * inside an effect — multiple windows on first launch would otherwise each
 * fire a fetch and stomp each other's `setActiveSessionId` write.
 */
export const useAgentSessionInitializer = () => {
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const {
    data: activeSession,
    error: activeSessionError,
    isLoading: isActiveSessionLoading
  } = useQuery('/agent-sessions/:sessionId', {
    params: { sessionId: activeSessionId! },
    enabled: !!activeSessionId,
    swrOptions: {
      keepPreviousData: false
    }
  })

  const activeSessionMissingAgent = Boolean(activeSessionId && activeSession && !activeSession.agentId)
  const activeSessionUnavailable = Boolean(
    activeSessionId && !isActiveSessionLoading && !activeSession && !activeSessionError
  )
  const needsFallbackSession =
    !activeSessionId || !!activeSessionError || activeSessionMissingAgent || activeSessionUnavailable
  const { data, isLoading: isFallbackSessionLoading } = useQuery('/agent-sessions', {
    query: { limit: FALLBACK_SESSION_SCAN_LIMIT },
    enabled: needsFallbackSession
  })

  useEffect(() => {
    if (
      activeSessionId &&
      !activeSessionMissingAgent &&
      (activeSession || isActiveSessionLoading) &&
      !activeSessionError
    )
      return

    if (needsFallbackSession && isFallbackSessionLoading && !data) return

    const fallbackId = resolveFallbackActiveSessionId(data?.items ?? [], { allowOrphan: !activeSessionMissingAgent })
    if (fallbackId && fallbackId !== activeSessionId) {
      setActiveSessionId(fallbackId)
      return
    }

    if (!fallbackId && activeSessionId && (activeSessionError || activeSessionUnavailable)) {
      setActiveSessionId(null)
    }
  }, [
    activeSession,
    activeSessionError,
    activeSessionId,
    activeSessionMissingAgent,
    activeSessionUnavailable,
    data,
    isFallbackSessionLoading,
    isActiveSessionLoading,
    needsFallbackSession,
    setActiveSessionId
  ])
}
