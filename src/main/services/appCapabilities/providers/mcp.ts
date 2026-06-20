import { mcpServerService } from '@data/services/McpServerService'
import mcpService from '@main/services/MCPService'

import { readRendererStoreValue } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { normalizeBoundedIntegerInput, okResult, sanitizeForAgent } from '../utils'

const DEFAULT_MCP_TOOL_LIST_LIMIT = 50
const MAX_MCP_TOOL_LIST_LIMIT = 200
const RENDERER_STORE_FALLBACK_TIMEOUT_MS = 500

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('MCP capability input must be an object')
  return input as Record<string, unknown>
}

function throwIfMcpSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error('MCP capability call aborted')
}

function normalizeListLimit(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'MCP tool list limit',
    defaultValue: DEFAULT_MCP_TOOL_LIST_LIMIT,
    min: 1,
    max: MAX_MCP_TOOL_LIST_LIMIT
  })
}

function normalizeOffset(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'MCP tool list offset',
    defaultValue: 0,
    min: 0
  })
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${label} is required`)
  return text
}

function normalizeToolParams(value: unknown) {
  if (value === null || typeof value === 'undefined') return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP tool params must be an object')
  return value as Record<string, unknown>
}

function compactMcpTool(tool: any, includeSchemas: boolean) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    serverId: tool.serverId,
    serverName: tool.serverName,
    type: tool.type,
    isBuiltIn: tool.isBuiltIn,
    ...(includeSchemas
      ? {
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema
        }
      : {})
  }
}

async function listConfiguredMcpServers(signal?: AbortSignal) {
  throwIfMcpSignalAborted(signal)
  try {
    const { items } = await mcpServerService.list({})
    if (items.length > 0) return items
  } catch {
    // Fall back to the legacy renderer store for pre-hydration or DB startup
    // edge cases; listing servers is a read-only diagnostic capability.
  }

  const mcpState = await readRendererStoreValue<any>('state.mcp', {
    checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    signal
  }).catch((error) => {
    if (signal?.aborted) throw error
    return null
  })
  return Array.isArray(mcpState?.servers) ? mcpState.servers : []
}

export function createMcpCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'mcp.servers.list',
      domain: 'mcp',
      kind: 'query',
      title: 'List MCP servers',
      description: 'List configured MCP servers with secrets redacted.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['mcp', 'servers', 'tools'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        return okResult('MCP servers listed', sanitizeForAgent(await listConfiguredMcpServers(context.signal)))
      }
    },
    {
      id: 'mcp.tools.list',
      domain: 'mcp',
      kind: 'query',
      title: 'List active MCP tools',
      description: 'List tools from active MCP servers.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: DEFAULT_MCP_TOOL_LIST_LIMIT },
          offset: { type: 'number', default: 0 },
          includeSchemas: { type: 'boolean', default: false }
        }
      },
      risk: 'read',
      tags: ['mcp', 'tools', 'list'],
      execute: async (input: unknown) => {
        const inputObject = normalizeInputObject(input)
        const limit = normalizeListLimit(inputObject.limit)
        const offset = normalizeOffset(inputObject.offset)
        const includeSchemas = inputObject.includeSchemas === true
        const tools = await mcpService.listAllActiveServerTools()
        const page = tools.slice(offset, offset + limit)
        return okResult('MCP tools listed', {
          total: tools.length,
          limit,
          offset,
          nextOffset: offset + limit < tools.length ? offset + limit : null,
          tools: sanitizeForAgent(page.map((tool) => compactMcpTool(tool, includeSchemas)))
        })
      }
    },
    {
      id: 'mcp.tool.call',
      domain: 'mcp',
      kind: 'command',
      title: 'Call MCP tool',
      description: 'Call an active MCP tool by tool id. Prefer directly injected MCP tools when available.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Tool id in serverId__toolName format' },
          params: { type: 'object', additionalProperties: true, description: 'Tool parameters' }
        },
        required: ['toolId']
      },
      risk: 'external',
      permissions: ['mcp.tool.call'],
      sideEffects: ['mcp.tool.call'],
      tags: ['mcp', 'tools', 'call'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        return okResult(
          'MCP tool called',
          sanitizeForAgent(
            await mcpService.callToolById(
              normalizeRequiredText(inputObject.toolId, 'MCP tool id'),
              normalizeToolParams(inputObject.params),
              context.toolCallId
            )
          )
        )
      }
    }
  ]
}
