import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mcpService: {
    listAllActiveServerTools: vi.fn(),
    callToolById: vi.fn()
  },
  reduxService: {
    select: vi.fn()
  }
}))

vi.mock('@main/services/MCPService', () => ({
  default: mocks.mcpService
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: mocks.reduxService
}))

vi.mock('../../utils', () => ({
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  sanitizeForAgent: (value: unknown) => value
}))

import { createMcpCapabilities } from '../mcp'

function capability(id: string) {
  const item = createMcpCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

function makeTool(index: number) {
  return {
    id: `server__tool_${index}`,
    name: `tool_${index}`,
    description: `Tool ${index}`,
    serverId: 'server',
    serverName: 'Server',
    type: 'mcp',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' }
      },
      required: []
    }
  }
}

describe('mcp app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mcpService.listAllActiveServerTools.mockResolvedValue([makeTool(1), makeTool(2), makeTool(3)])
  })

  it('lists MCP tools as bounded descriptors without schemas by default', async () => {
    const result = await capability('mcp.tools.list').execute({ limit: 2 }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
      nextOffset: 2
    })
    expect((result.data as any).tools).toHaveLength(2)
    expect((result.data as any).tools[0]).toMatchObject({
      id: 'server__tool_1',
      name: 'tool_1',
      serverId: 'server'
    })
    expect((result.data as any).tools[0]).not.toHaveProperty('inputSchema')
  })

  it('returns MCP schemas only when explicitly requested', async () => {
    const result = await capability('mcp.tools.list').execute(
      { includeSchemas: true, limit: 1, offset: 1 },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      total: 3,
      limit: 1,
      offset: 1,
      nextOffset: 2
    })
    expect((result.data as any).tools).toEqual([
      expect.objectContaining({
        id: 'server__tool_2',
        inputSchema: expect.objectContaining({ type: 'object' })
      })
    ])
  })
})
