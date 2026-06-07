import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, mutate: vi.fn() })
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    navigate: navigateMock
  }
}))

const listenerKey = '__CHERRY_STUDIO_PI_MCP_ADD_SERVER_LISTENER__'

describe('useMcpServer module listener', () => {
  const onMock = vi.fn()
  let addServerHandler: ((_event: unknown, server: { id: string }) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>)[listenerKey]
    addServerHandler = undefined

    onMock.mockImplementation((channel: string, handler: (_event: unknown, server: { id: string }) => void) => {
      if (channel === IpcChannel.Mcp_AddServer) {
        addServerHandler = handler
      }
      return vi.fn()
    })

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: onMock
        }
      }
    })
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[listenerKey]
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined
    })
  })

  it('registers the MCP install listener once and opens the installed server details', async () => {
    const module = await import('../useMcpServer')
    module.registerMcpAddServerNavigationListener()

    expect(onMock).toHaveBeenCalledTimes(1)
    expect(onMock).toHaveBeenCalledWith(IpcChannel.Mcp_AddServer, expect.any(Function))

    addServerHandler?.(null, { id: 'server-1' })

    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/mcp/settings/server-1' })
  })

  it('does not crash in non-electron renderer test environments', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined
    })

    await expect(import('../useMcpServer')).resolves.toBeTruthy()

    expect(onMock).not.toHaveBeenCalled()
  })
})
