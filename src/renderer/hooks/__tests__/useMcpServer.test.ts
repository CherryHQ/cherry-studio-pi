import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerWarnMock, navigateMock, swrMutateMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  navigateMock: vi.fn(),
  swrMutateMock: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, mutate: vi.fn() })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock
    })
  }
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    navigate: navigateMock
  }
}))

vi.mock('swr', () => ({
  mutate: swrMutateMock
}))

const listenerKey = '__CHERRY_STUDIO_PI_MCP_ADD_SERVER_LISTENER__'

describe('useMcpServer module listener', () => {
  const onMock = vi.fn()
  let removeMock: ReturnType<typeof vi.fn>
  let addServerHandler: ((_event: unknown, server: { id?: string; name: string; command?: string }) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    swrMutateMock.mockResolvedValue(undefined)
    delete (globalThis as Record<string, unknown>)[listenerKey]
    addServerHandler = undefined
    removeMock = vi.fn()

    onMock.mockImplementation(
      (channel: string, handler: (_event: unknown, server: { id?: string; name: string }) => void) => {
        if (channel === IpcChannel.Mcp_AddServer) {
          addServerHandler = handler
        }
        return removeMock
      }
    )

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

    const server = { id: 'created-server-1', name: 'server-1', command: 'npx' }
    addServerHandler?.(null, server)

    expect(swrMutateMock).toHaveBeenCalledWith(expect.any(Function))
    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1)
      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/mcp/settings/created-server-1' })
    })
  })

  it('unregisters the module listener and allows a fresh registration', async () => {
    const module = await import('../useMcpServer')

    expect(onMock).toHaveBeenCalledTimes(1)

    module.unregisterMcpAddServerNavigationListener()

    expect(removeMock).toHaveBeenCalledTimes(1)
    expect((globalThis as Record<string, unknown>)[listenerKey]).toBeUndefined()

    module.registerMcpAddServerNavigationListener()

    expect(onMock).toHaveBeenCalledTimes(2)
  })

  it('still opens the installed server details when cache refresh fails', async () => {
    swrMutateMock.mockRejectedValueOnce(new Error('refresh failed'))

    const module = await import('../useMcpServer')
    module.registerMcpAddServerNavigationListener()

    addServerHandler?.(null, { id: 'created-server-1', name: 'server-1', command: 'npx' })

    await vi.waitFor(() => {
      expect(loggerWarnMock).toHaveBeenCalledWith(
        'Failed to refresh MCP servers after protocol install',
        expect.any(Error)
      )
    })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/mcp/settings/created-server-1' })
  })

  it('ignores malformed protocol install events without a server id', async () => {
    const module = await import('../useMcpServer')
    module.registerMcpAddServerNavigationListener()

    addServerHandler?.(null, { name: 'server-1', command: 'npx' })

    expect(swrMutateMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalledWith('Ignoring MCP protocol install event without a server id')
  })

  it('does not crash in non-electron renderer test environments', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined
    })

    await expect(import('../useMcpServer')).resolves.toBeTruthy()

    expect(onMock).not.toHaveBeenCalled()
  })

  it('does not crash when imported without a browser window', async () => {
    vi.stubGlobal('window', undefined)

    try {
      await expect(import('../useMcpServer')).resolves.toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }

    expect(onMock).not.toHaveBeenCalled()
  })
})
