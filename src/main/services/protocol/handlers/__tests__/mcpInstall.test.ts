import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, mainWindowServiceMock, windowManagerMock } = vi.hoisted(() => {
  const windowManagerMock = {
    broadcastToType: vi.fn()
  }
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'MainWindowService') return mainWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }

  return { applicationMock, loggerMock, mainWindowServiceMock, windowManagerMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@reduxjs/toolkit', () => ({
  nanoid: vi.fn(() => 'server-id')
}))

import { handleMcpProtocolUrl } from '../mcpInstall'

const toBase64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64')
const toUrlSafeBase64 = (value: unknown) => toBase64(value).replaceAll('+', '_').replaceAll('/', '-')

describe('mcpInstall protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs MCP servers without logging raw protocol payload secrets', () => {
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

    handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toBase64(payload)}`))

    expect(windowManagerMock.broadcastToType).toHaveBeenCalled()
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalled()

    const logs = JSON.stringify(loggerMock.debug.mock.calls)
    expect(logs).toContain('install MCP servers from protocol')
    expect(logs).not.toContain('sk-secret-token')
  })

  it('preserves standard base64 plus characters in the servers query parameter', () => {
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
    handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${data}`))

    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: {
          API_KEY: 'sk-\u{1FAE0}'
        }
      })
    )
  })

  it('accepts URL-safe base64 MCP install payloads', () => {
    const payload = {
      mcpServers: {
        privateServer: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything']
        }
      }
    }

    handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${toUrlSafeBase64(payload)}`))

    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      })
    )
  })

  it('logs unknown MCP protocol URLs without raw query payloads', () => {
    handleMcpProtocolUrl(new URL('cherrystudio://mcp/unknown?servers=sk-secret-token#raw-secret'))

    const logs = JSON.stringify(loggerMock.error.mock.calls)
    expect(logs).toContain('Unknown MCP protocol URL')
    expect(logs).not.toContain('sk-secret-token')
    expect(logs).not.toContain('raw-secret')
  })
})
