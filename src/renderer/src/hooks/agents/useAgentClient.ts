import { AgentIpcClient } from '@renderer/api/agent-ipc'
import { useMemo } from 'react'

export const useAgentClient = () => {
  return useMemo(() => new AgentIpcClient(), [])
}
