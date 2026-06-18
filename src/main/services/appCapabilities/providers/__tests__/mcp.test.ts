import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserWindows: [
    {
      isDestroyed: vi.fn(() => false),
      webContents: {
        executeJavaScript: vi.fn()
      }
    }
  ],
  getAllWindows: vi.fn(),
  mcpService: {
    listAllActiveServerTools: vi.fn(),
    callToolById: vi.fn()
  },
  mcpServerService: {
    list: vi.fn()
  },
  reduxService: {
    select: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

vi.mock('@main/services/MCPService', () => ({
  default: mocks.mcpService
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: mocks.mcpServerService
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

import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'

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
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE)) {
        return {
          servers: [
            { id: 'server-1', name: 'Server 1', command: 'npx', env: { TOKEN: 'secret' } },
            { id: 'server-2', name: 'Server 2', command: 'uvx' }
          ]
        }
      }
      return undefined
    })
    mocks.mcpServerService.list.mockResolvedValue({
      items: [
        { id: 'server-1', name: 'Server 1', command: 'npx', env: { TOKEN: 'secret' } },
        { id: 'server-2', name: 'Server 2', command: 'uvx' }
      ],
      total: 2,
      page: 1
    })
    mocks.mcpService.listAllActiveServerTools.mockResolvedValue([makeTool(1), makeTool(2), makeTool(3)])
    mocks.mcpService.callToolById.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('lists configured MCP servers from the main-process data service', async () => {
    const result = await capability('mcp.servers.list').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { id: 'server-1', name: 'Server 1', command: 'npx', env: { TOKEN: 'secret' } },
      { id: 'server-2', name: 'Server 2', command: 'uvx' }
    ])
    expect(mocks.mcpServerService.list).toHaveBeenCalledWith({})
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('falls back to the renderer MCP store when the main-process data service has no configured servers yet', async () => {
    mocks.mcpServerService.list.mockResolvedValueOnce({ items: [], total: 0, page: 1 })

    const result = await capability('mcp.servers.list').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { id: 'server-1', name: 'Server 1', command: 'npx', env: { TOKEN: 'secret' } },
      { id: 'server-2', name: 'Server 2', command: 'uvx' }
    ])
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `window[${JSON.stringify(RENDERER_GET_STORE_VALUE_BRIDGE)}]({"path":"state.mcp"})`
    )
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

  it('normalizes MCP tool ids and params before calling tools', async () => {
    const result = await capability('mcp.tool.call').execute(
      { toolId: ' server__tool_1 ', params: { value: 'hello' } },
      { source: 'agent', toolCallId: 'tool-call-1' }
    )

    expect(result.ok).toBe(true)
    expect(mocks.mcpService.callToolById).toHaveBeenCalledWith('server__tool_1', { value: 'hello' }, 'tool-call-1')
  })

  it('rejects empty MCP tool ids and invalid params before calling tools', async () => {
    await expect(
      capability('mcp.tool.call').execute({ toolId: '   ', params: { value: 'hello' } }, { source: 'agent' })
    ).rejects.toThrow('MCP tool id is required')

    await expect(
      capability('mcp.tool.call').execute({ toolId: 'server__tool_1', params: 'bad' }, { source: 'agent' })
    ).rejects.toThrow('MCP tool params must be an object')

    await expect(
      capability('mcp.tool.call').execute({ toolId: 'server__tool_1', params: [] }, { source: 'agent' })
    ).rejects.toThrow('MCP tool params must be an object')

    await capability('mcp.tool.call').execute({ toolId: 'server__tool_1' }, { source: 'agent' })

    expect(mocks.mcpService.callToolById).toHaveBeenCalledTimes(1)
    expect(mocks.mcpService.callToolById).toHaveBeenCalledWith('server__tool_1', {}, undefined)
  })
})
