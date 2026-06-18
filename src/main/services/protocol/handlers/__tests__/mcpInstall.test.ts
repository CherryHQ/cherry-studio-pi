import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, mainWindowServiceMock, mcpServerServiceMock, windowManagerMock } = vi.hoisted(
  () => {
    const windowManagerMock = {
      broadcastToType: vi.fn()
    }
    const mainWindowServiceMock = {
      showMainWindow: vi.fn()
    }
    const mcpServerServiceMock = {
      create: vi.fn()
    }
    const loggerMock = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    }
    const applicationMock = {
      get: vi.fn((name: string) => {
        if (name === 'WindowManager') return windowManagerMock
        if (name === 'MainWindowService') return mainWindowServiceMock
        throw new Error(`unexpected service: ${name}`)
      })
    }

    return { applicationMock, loggerMock, mainWindowServiceMock, mcpServerServiceMock, windowManagerMock }
  }
)

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: mcpServerServiceMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import { handleMcpProtocolUrl } from '../mcpInstall'

const toBase64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64')
const toUrlSafeBase64 = (value: unknown) => toBase64(value).replaceAll('+', '_').replaceAll('/', '-')

describe('mcpInstall protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpServerServiceMock.create.mockImplementation(async (server) => ({
      id: `created-${server.name}`,
      ...server,
      isActive: server.isActive ?? false
    }))
  })

  it('installs MCP servers without logging raw protocol payload secrets', async () => {
    const payload = {
      mcpServers: {
        privateServer: {
          command: 'npx',
          env: {
            API_KEY: 'sk-secret-token'
          }
        }
      }
    }

    await handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toBase64(payload)}`))

    expect(mcpServerServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'privateServer',
        command: 'npx',
        installSource: 'protocol',
        isTrusted: false,
        isActive: false
      })
    )
    expect(mcpServerServiceMock.create.mock.calls[0][0]).not.toHaveProperty('id')
    expect(windowManagerMock.broadcastToType).toHaveBeenCalled()
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalled()
    expect(windowManagerMock.broadcastToType.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        id: 'created-privateServer',
        name: 'privateServer',
        command: 'npx',
        installSource: 'protocol',
        isTrusted: false,
        isActive: false
      })
    )

    const logs = JSON.stringify(loggerMock.debug.mock.calls)
    expect(logs).toContain('install MCP servers from protocol')
    expect(logs).not.toContain('sk-secret-token')
  })

  it('preserves standard base64 plus characters in the servers query parameter', async () => {
    const payload = {
      mcpServers: {
        privateServer: {
          command: 'npx',
          env: {
            API_KEY: 'sk-\u{1FAE0}'
          }
        }
      }
    }
    const data = toBase64(payload)

    expect(data).toContain('+')
    await handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${data}`))

    expect(mcpServerServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'privateServer',
        env: {
          API_KEY: 'sk-\u{1FAE0}'
        }
      })
    )
  })

  it('accepts URL-safe base64 MCP install payloads', async () => {
    const payload = {
      mcpServers: {
        privateServer: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything']
        }
      }
    }

    await handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toUrlSafeBase64(payload)}`))

    expect(mcpServerServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'privateServer',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      })
    )
  })

  it('does not throw or broadcast malformed MCP install payloads', async () => {
    await expect(handleMcpProtocolUrl(new URL('cherrystudio://mcp/install?servers=not-json'))).resolves.toBeUndefined()

    expect(mcpServerServiceMock.create).not.toHaveBeenCalled()
    expect(windowManagerMock.broadcastToType).not.toHaveBeenCalled()
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to parse MCP protocol install payload', expect.any(Error))
  })

  it('skips invalid MCP server entries without dropping valid entries', async () => {
    const payload = [null, 'bad', { name: 'valid-server', command: 'npx' }]

    await handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toBase64(payload)}`))

    expect(mcpServerServiceMock.create).toHaveBeenCalledTimes(1)
    expect(windowManagerMock.broadcastToType).toHaveBeenCalledTimes(1)
    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        name: 'valid-server',
        command: 'npx'
      })
    )
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipping invalid MCP protocol server entry: expected object')
  })

  it('logs install failures without raw protocol payload secrets', async () => {
    const payload = {
      mcpServers: {
        privateServer: {
          command: 'npx',
          env: {
            API_KEY: 'sk-secret-token'
          }
        }
      }
    }
    mcpServerServiceMock.create.mockRejectedValueOnce(new Error('insert failed with params sk-secret-token'))

    await handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toBase64(payload)}`))

    expect(windowManagerMock.broadcastToType).not.toHaveBeenCalled()
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalled()
    const logs = JSON.stringify(loggerMock.error.mock.calls)
    expect(logs).toContain('Failed to install MCP server from protocol')
    expect(logs).not.toContain('sk-secret-token')
  })

  it('logs unknown MCP protocol URLs without raw query payloads', async () => {
    await handleMcpProtocolUrl(new URL('cherrystudio://mcp/unknown?servers=sk-secret-token#raw-secret'))

    const logs = JSON.stringify(loggerMock.error.mock.calls)
    expect(logs).toContain('Unknown MCP protocol URL')
    expect(logs).not.toContain('sk-secret-token')
    expect(logs).not.toContain('raw-secret')
  })
})
