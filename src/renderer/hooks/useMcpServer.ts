import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import NavigationService from '@renderer/services/NavigationService'
import type { McpTool } from '@renderer/types'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import type { CreateMcpServerDto, ListMcpServersQuery } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'
import { mutate as mutateSWRCache } from 'swr'

const MCP_ADD_SERVER_LISTENER_KEY = '__CHERRY_STUDIO_PI_MCP_ADD_SERVER_LISTENER__'
const logger = loggerService.withContext('useMcpServer')

type McpAddServerListenerState = {
  remove: () => void
}

type McpAddServerListenerGlobal = typeof globalThis & {
  [MCP_ADD_SERVER_LISTENER_KEY]?: boolean | McpAddServerListenerState
}

function handleProtocolMcpServerInstalled(server: McpServer): void {
  if (!server?.id) {
    logger.warn('Ignoring MCP protocol install event without a server id')
    return
  }

  void mutateSWRCache((key) => Array.isArray(key) && key[0] === '/mcp-servers').catch((error) => {
    logger.warn('Failed to refresh MCP servers after protocol install', error as Error)
  })
  void NavigationService.navigate?.({ to: `/settings/mcp/settings/${server.id}` })
}

/**
 * Navigate to MCP server settings when a server is installed via URL scheme.
 * The listener is module-scoped, so guard it for renderer tests and Vite HMR.
 */
export function registerMcpAddServerNavigationListener() {
  if (typeof window === 'undefined') return

  const ipcRenderer = window.electron?.ipcRenderer
  if (!ipcRenderer) return

  const globalState = globalThis as McpAddServerListenerGlobal
  if (globalState[MCP_ADD_SERVER_LISTENER_KEY]) return

  const remove = ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: McpServer) => {
    handleProtocolMcpServerInstalled(server)
  })
  globalState[MCP_ADD_SERVER_LISTENER_KEY] = { remove }
}

export function unregisterMcpAddServerNavigationListener() {
  const globalState = globalThis as McpAddServerListenerGlobal
  const state = globalState[MCP_ADD_SERVER_LISTENER_KEY]

  if (state && typeof state === 'object') {
    state.remove()
  }

  delete globalState[MCP_ADD_SERVER_LISTENER_KEY]
}

registerMcpAddServerNavigationListener()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterMcpAddServerNavigationListener()
  })
}

/**
 * MCP servers list hook — data fetching with optional filters and create mutation.
 */
export const useMcpServers = (query?: ListMcpServersQuery) => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers', { query })

  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const { trigger: createMcpServer } = useMutation('POST', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const addMcpServer = useCallback((dto: CreateMcpServerDto) => createMcpServer({ body: dto }), [createMcpServer])

  const { trigger: reorderTrigger } = useMutation('PATCH', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const reorderMcpServers = useCallback(
    (reorderedList: McpServer[]) => {
      void mutate(data ? { ...data, items: reorderedList } : undefined, false)
      reorderTrigger({ body: { orderedIds: reorderedList.map((s) => s.id) } }).catch((error) => {
        logger.warn('Failed to reorder MCP servers, reverting', error as Error)
        void mutate()
      })
    },
    [data, mutate, reorderTrigger]
  )

  return {
    mcpServers,
    isLoading,
    addMcpServer,
    reorderMcpServers,
    refetch: mutate
  }
}

/**
 * Single MCP server hook — read + update + delete.
 * Fetches via the list endpoint with an id filter (separate SWR cache entry
 * from the unfiltered list). Mutations use refresh: ['/mcp-servers'] to
 * auto-invalidate all /mcp-servers caches (list, filtered, and detail).
 */
export const useMcpServer = (id: string) => {
  const { data, isLoading } = useQuery('/mcp-servers', {
    query: { id },
    enabled: !!id
  })

  const { updateMcpServer, deleteMcpServer } = useMcpServerMutations(id)

  const server = useMemo(() => data?.items?.[0], [data])

  return { server, isLoading, updateMcpServer, deleteMcpServer }
}

/**
 * Resolve auto-approval for a tool without plumbing the server prop through
 * every renderer. Reads the server list from the shared `/mcp-servers` SWR
 * query.
 */
export const useIsToolAutoApproved = (tool: McpTool): boolean => {
  const { mcpServers } = useMcpServers()
  return useMemo(() => {
    const server = mcpServers.find((s) => s.id === tool.serverId)
    return server ? resolveMcpSourceToolAccess(server, tool).approval === 'auto' : false
  }, [mcpServers, tool])
}

/**
 * Mutation-only hook for a single MCP server — no query, no N+1.
 * Use when server data is already available from a parent (e.g. from useMcpServers list).
 */
export const useMcpServerMutations = (id: string) => {
  const path = `/mcp-servers/${id}` as const

  const { trigger: updateMcpServer } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  const { trigger: deleteMcpServer } = useMutation('DELETE', path, {
    refresh: ['/mcp-servers']
  })

  return { updateMcpServer, deleteMcpServer }
}
