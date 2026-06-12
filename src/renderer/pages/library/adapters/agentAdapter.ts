import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { AGENTS_MAX_LIMIT, type CreateAgentDto, type UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { CreateAgentSessionDto } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity, CreateAgentWorkspaceDto } from '@shared/data/api/schemas/agentWorkspaces'
import { useCallback } from 'react'

import type { AgentDetail } from '../types'
import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * List hook for agent resources — mirrors `assistantAdapter.useAssistantList`.
 *
 * `search` is forwarded to `GET /agents` and evaluated server-side (see
 * `AgentService.listAgents`), so callers don't need to chain a client-side
 * filter on top.
 */
function useAgentList(query?: ResourceListQuery): ResourceListResult<AgentDetail> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/agents', {
    query: {
      limit: query?.limit ?? AGENTS_MAX_LIMIT,
      ...(query?.search ? { search: query.search } : {})
    }
  })

  const items = data?.items ?? []
  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    data: items,
    isLoading,
    isRefreshing,
    error,
    refetch: stableRefetch
  }
}

export const agentAdapter: ResourceAdapter<AgentDetail> = {
  resource: 'agent',
  useList: useAgentList
}

/** List-level write hook — create only. */
export function useAgentMutations() {
  const { trigger: createTrigger } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })

  const createAgent = useCallback(
    (dto: CreateAgentDto): Promise<AgentDetail> => createTrigger({ body: dto }),
    [createTrigger]
  )

  return { createAgent }
}

/** Mutations used by the guided agent create flow after the agent row exists. */
export function useAgentCreateCompanionMutations() {
  const { trigger: createWorkspaceTrigger } = useMutation('POST', '/agent-workspaces', {
    refresh: ['/agent-workspaces']
  })
  const { trigger: createSessionTrigger } = useMutation('POST', '/agent-sessions', {
    refresh: ['/agent-sessions']
  })

  const createWorkspaceByPath = useCallback(
    (path: string, name?: string): Promise<AgentWorkspaceEntity> => {
      const body: CreateAgentWorkspaceDto = { path, ...(name ? { name } : {}) }
      return createWorkspaceTrigger({ body })
    },
    [createWorkspaceTrigger]
  )

  const createInitialSession = useCallback(
    (dto: CreateAgentSessionDto) => createSessionTrigger({ body: dto }),
    [createSessionTrigger]
  )

  return { createWorkspaceByPath, createInitialSession }
}

/**
 * Mutation hook scoped to a single agent id. PATCH accepts any `AgentBase`
 * subset (typed as `UpdateAgentDto`); the backend merges at the row level.
 * DELETE cascades sessions / tasks on the main side.
 */
export function useAgentMutationsById(id: string) {
  const path = `/agents/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    refresh: ['/agents']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/agents']
  })

  const updateAgent = useCallback(
    (dto: UpdateAgentDto): Promise<AgentDetail> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAgent = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updateAgent, deleteAgent }
}
