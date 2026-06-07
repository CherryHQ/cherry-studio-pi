import { cacheService } from '@renderer/data/CacheService'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import type { AgentType } from '@renderer/types'
import { claudeCodeBuiltinToolDescriptors } from '@shared/ai/claudecode/builtinTools'
import {
  buildClaudeMcpToolName,
  type ClaudeToolDescriptor,
  resolveClaudeToolAccess
} from '@shared/ai/claudecode/toolRules'
import type { Tool } from '@shared/ai/tool'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import type { AgentConfiguration, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type McpToolsCacheKey = `mcp.tools.${string}`

const mcpToolsCacheKey = (serverId: string): McpToolsCacheKey => `mcp.tools.${serverId}`

export type AgentToolSource = {
  type?: AgentType
  mcps?: string[]
  allowedTools?: string[]
  configuration?: Pick<AgentConfiguration, 'permission_mode'> | null
  permissionMode?: AgentPermissionMode | string | null
}

function useMcpToolsCache(serverIds: readonly string[]): Record<string, McpTool[]> {
  const serverIdsSignature = JSON.stringify(Array.from(new Set(serverIds)).sort())
  const uniqueIds = useMemo(() => JSON.parse(serverIdsSignature) as string[], [serverIdsSignature])
  const cacheKeys = useMemo(() => uniqueIds.map((id) => mcpToolsCacheKey(id)), [uniqueIds])

  const readSnapshot = useCallback(
    () =>
      Object.fromEntries(
        uniqueIds.map((id) => [id, cacheService.getShared(mcpToolsCacheKey(id) as SharedCacheKey) ?? []])
      ) as Record<string, McpTool[]>,
    [uniqueIds]
  )

  const [snapshot, setSnapshot] = useState<Record<string, McpTool[]>>(readSnapshot)

  useEffect(() => {
    setSnapshot(readSnapshot())
    const disposers = cacheKeys.map((key) => cacheService.subscribe(key, () => setSnapshot(readSnapshot())))
    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [cacheKeys, readSnapshot])

  return snapshot
}

function toTool(descriptor: ClaudeToolDescriptor, source: AgentToolSource): Tool {
  const decision = resolveClaudeToolAccess(descriptor, {
    permissionMode: source.configuration?.permission_mode ?? (source.permissionMode as AgentPermissionMode | undefined),
    allowedTools: source.allowedTools ?? []
  })
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    origin: descriptor.origin,
    approval: decision.approval,
    sourceId: descriptor.sourceId,
    sourceName: descriptor.sourceName
  }
}

function mcpDescriptors(server: McpServer, tools: readonly McpTool[]): ClaudeToolDescriptor[] {
  if (!server.isActive) return []
  return tools.flatMap((tool) => {
    const sourceAccess = resolveMcpSourceToolAccess(server, tool)
    if (!sourceAccess.enabled) return []
    return [
      {
        id: buildClaudeMcpToolName(server.name, tool.name),
        name: tool.name,
        description: tool.description || '',
        origin: 'mcp',
        sourceId: server.id,
        sourceName: server.name,
        sourceToolName: tool.name,
        sourceApproval: sourceAccess.approval
      }
    ]
  })
}

export const useAgentTools = (source: AgentToolSource | null | undefined) => {
  const { mcpServers, isLoading } = useMcpServers()
  const mcpIds = useMemo(() => source?.mcps ?? [], [source?.mcps])
  const toolsByServer = useMcpToolsCache(mcpIds)
  const requestedRefreshes = useRef(new Set<string>())

  useEffect(() => {
    const selectedServers = new Map(mcpServers.map((server) => [server.id, server]))
    for (const id of mcpIds) {
      const server = selectedServers.get(id)
      if (!server?.isActive || requestedRefreshes.current.has(id)) continue
      if ((toolsByServer[id]?.length ?? 0) > 0) continue
      requestedRefreshes.current.add(id)
      void window.api.mcp.refreshTools(server.id).catch(() => {
        requestedRefreshes.current.delete(id)
      })
    }
  }, [mcpIds, mcpServers, toolsByServer])

  const tools = useMemo<Tool[]>(() => {
    if ((source?.type ?? 'claude-code') !== 'claude-code') return []

    const selectedServers = new Map(mcpServers.map((server) => [server.id, server]))
    const descriptors: ClaudeToolDescriptor[] = [...claudeCodeBuiltinToolDescriptors()]
    for (const id of mcpIds) {
      const server = selectedServers.get(id)
      if (!server) continue
      descriptors.push(...mcpDescriptors(server, toolsByServer[id] ?? []))
    }
    return descriptors.map((descriptor) => toTool(descriptor, source ?? {}))
  }, [mcpIds, mcpServers, source, toolsByServer])

  return { tools, error: undefined, isLoading }
}
