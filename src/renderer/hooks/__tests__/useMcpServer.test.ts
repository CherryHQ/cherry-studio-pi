import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dataApiPostMock, loggerWarnMock, navigateMock, swrMutateMock } = vi.hoisted(() => ({
  dataApiPostMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  navigateMock: vi.fn(),
  swrMutateMock: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, mutate: vi.fn() })
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    post: dataApiPostMock
  }
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
  let addServerHandler: ((_event: unknown, server: { name: string; command?: string }) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    dataApiPostMock.mockResolvedValue({ id: 'created-server-1' })
    swrMutateMock.mockResolvedValue(undefined)
    delete (globalThis as Record<string, unknown>)[listenerKey]
    addServerHandler = undefined

    onMock.mockImplementation((channel: string, handler: (_event: unknown, server: { name: string }) => void) => {
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

    const server = { name: 'server-1', command: 'npx' }
    addServerHandler?.(null, server)

    await vi.waitFor(() => {
      expect(dataApiPostMock).toHaveBeenCalledWith('/mcp-servers', { body: server })
    })
    expect(swrMutateMock).toHaveBeenCalledWith(expect.any(Function))
    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1)
      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/mcp/settings/created-server-1' })
    })
  })

  it('logs protocol install failures instead of navigating to a non-existent server', async () => {
    dataApiPostMock.mockRejectedValueOnce(new Error('create failed'))

    const module = await import('../useMcpServer')
    module.registerMcpAddServerNavigationListener()

    addServerHandler?.(null, { name: 'server-1', command: 'npx' })

    await vi.waitFor(() => {
      expect(loggerWarnMock).toHaveBeenCalledWith('Failed to install MCP server from protocol', expect.any(Error))
    })
    expect(navigateMock).not.toHaveBeenCalled()
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
