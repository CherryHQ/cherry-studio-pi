import { useMutation } from '@renderer/data/hooks/useDataApi'
import { getErrorMessage } from '@renderer/utils/error'
import type { AgentWorkspaceEntity, CreateAgentWorkspaceDto } from '@shared/data/api/schemas/agentWorkspaces'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function useAgentWorkspaceMutations() {
  const { t } = useTranslation()
  const { trigger: createWorkspaceTrigger } = useMutation('POST', '/agent-workspaces', {
    refresh: ['/agent-workspaces']
  })

  const createWorkspaceByPath = useCallback(
    async (path: string, name?: string): Promise<AgentWorkspaceEntity | undefined> => {
      try {
        const body: CreateAgentWorkspaceDto = { path, ...(name ? { name } : {}) }
        return await createWorkspaceTrigger({ body })
      } catch (error) {
        window.toast?.error({
          title: t('agent.session.workspace.create_failed'),
          description: getErrorMessage(error)
        })
        return undefined
      }
    },
    [createWorkspaceTrigger, t]
  )

  return { createWorkspaceByPath }
}
