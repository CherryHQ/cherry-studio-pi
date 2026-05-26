import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgent = (id: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null

  const fetcher = useCallback(async () => {
    if (!id) {
      throw new Error(t('agent.get.error.null_id'))
    }
    const result = await client.getAgent(id)
    return result
  }, [client, id, t])
  const {
    data,
    error,
    isLoading,
    mutate: revalidate
  } = useSWR(key, fetcher, {
    // Agent config may be modified externally (e.g. claw MCP tool in main process),
    // so always revalidate on mount and reduce dedup window to get fresh data.
    revalidateOnMount: true,
    dedupingInterval: 2000
  })

  return {
    agent: data,
    error,
    isLoading,
    revalidate
  }
}
