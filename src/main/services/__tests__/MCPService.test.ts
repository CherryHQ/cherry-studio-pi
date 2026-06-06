import type { MCPServer, MCPTool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/utils/mcp', () => ({
  getMCPServersFromRedux: vi.fn()
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

import { getMCPServersFromRedux } from '@main/apiServer/utils/mcp'
import { CacheService } from '@main/services/CacheService'
import mcpService from '@main/services/MCPService'

const baseInputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] } = {
  type: 'object',
  properties: {},
  required: []
}

const createTool = (overrides: Partial<MCPTool>): MCPTool => ({
  id: `${overrides.serverId}__${overrides.name}`,
  name: overrides.name ?? 'tool',
  description: overrides.description,
  serverId: overrides.serverId ?? 'server',
  serverName: overrides.serverName ?? 'server',
  inputSchema: baseInputSchema,
  type: 'mcp',
  ...overrides
})

describe('MCPService.listAllActiveServerTools', () => {
  beforeEach(() => {
    CacheService.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    CacheService.clear()
    vi.restoreAllMocks()
  })

  it('filters disabled tools per server', async () => {
    const servers: MCPServer[] = [
      {
        id: 'alpha',
        name: 'Alpha',
        isActive: true,
        disabledTools: ['disabled_tool']
      },
      {
        id: 'beta',
        name: 'Beta',
        isActive: true
      }
    ]

    vi.mocked(getMCPServersFromRedux).mockResolvedValue(servers)

    const listToolsSpy = vi.spyOn(mcpService as any, 'listToolsImpl').mockImplementation(async (server: any) => {
      if (server.id === 'alpha') {
        return [
          createTool({ name: 'enabled_tool', serverId: server.id, serverName: server.name }),
          createTool({ name: 'disabled_tool', serverId: server.id, serverName: server.name })
        ]
      }
      return [createTool({ name: 'beta_tool', serverId: server.id, serverName: server.name })]
    })

    const tools = await mcpService.listAllActiveServerTools()

    expect(listToolsSpy).toHaveBeenCalledTimes(2)
    expect(tools.map((tool) => tool.name)).toEqual(['enabled_tool', 'beta_tool'])
  })

  it('reuses cached server tool lists across repeated aggregate calls', async () => {
    const servers: MCPServer[] = [
      {
        id: 'alpha',
        name: 'Alpha',
        isActive: true
      }
    ]

    vi.mocked(getMCPServersFromRedux).mockResolvedValue(servers)

    const listToolsSpy = vi
      .spyOn(mcpService as any, 'listToolsImpl')
      .mockResolvedValue([createTool({ name: 'alpha_tool', serverId: 'alpha', serverName: 'Alpha' })])

    await expect(mcpService.listAllActiveServerTools()).resolves.toHaveLength(1)
    await expect(mcpService.listAllActiveServerTools()).resolves.toHaveLength(1)

    expect(listToolsSpy).toHaveBeenCalledTimes(1)
  })

  it('lists tools only for selected active servers', async () => {
    const servers: MCPServer[] = [
      {
        id: 'alpha',
        name: 'Alpha',
        isActive: true
      },
      {
        id: 'beta',
        name: 'Beta',
        isActive: true
      },
      {
        id: 'gamma',
        name: 'Gamma',
        isActive: false
      }
    ]

    vi.mocked(getMCPServersFromRedux).mockResolvedValue(servers)

    const listToolsSpy = vi.spyOn(mcpService as any, 'listToolsImpl').mockImplementation(async (server: any) => [
      createTool({
        name: `${server.id}_tool`,
        serverId: server.id,
        serverName: server.name
      })
    ])

    const tools = await mcpService.listActiveServerToolsByIds(['beta', 'gamma'])

    expect(listToolsSpy).toHaveBeenCalledTimes(1)
    expect(listToolsSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }))
    expect(tools.map((tool) => tool.name)).toEqual(['beta_tool'])
  })
})
