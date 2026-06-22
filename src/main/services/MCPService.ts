import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import type { McpCallToolResponse } from '@main/ai/mcp/types'
import type { McpTool } from '@shared/types/mcp'

const logger = loggerService.withContext('MCPServiceCompat')

class MCPServiceCompat {
  async listAllActiveServerTools(): Promise<McpTool[]> {
    const { items: servers } = await mcpServerService.list({ isActive: true })
    const catalog = application.get('McpCatalogService')

    const batches = await Promise.allSettled(servers.map((server) => catalog.listTools(server.id)))
    return batches.flatMap((batch, index) => {
      if (batch.status === 'fulfilled') return batch.value
      logger.warn('Failed to list MCP server tools', { serverId: servers[index]?.id, error: batch.reason })
      return []
    })
  }

  async listActiveServerToolsByIds(ids: string[] = []): Promise<McpTool[]> {
    const selectedIds = new Set(ids)
    const tools = await this.listAllActiveServerTools()
    if (selectedIds.size === 0) return tools

    return tools.filter(
      (tool) => selectedIds.has(tool.id) || selectedIds.has(tool.serverId) || selectedIds.has(tool.name)
    )
  }

  async callToolById(toolId: string, params: unknown, callId?: string): Promise<McpCallToolResponse> {
    return application.get('McpRuntimeService').callToolById(toolId, params, callId)
  }
}

const mcpService = new MCPServiceCompat()
export default mcpService
