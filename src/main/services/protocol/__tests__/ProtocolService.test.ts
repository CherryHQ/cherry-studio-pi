import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appMock,
  cherryInOauthServiceMock,
  execFileMock,
  fsPromisesMock,
  handlersMock,
  ipcHandlers,
  loggerMock,
  mainWindowServiceMock,
  platformMock,
  protocolWindowMock,
  protocolWindowWebContentsMock,
  windowManagerMock
} = vi.hoisted(() => {
  const appMock = {
    on: vi.fn(),
    removeListener: vi.fn(),
    setAsDefaultProtocolClient: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  const handlersMock = {
    handleMcpProtocolUrl: vi.fn(),
    handleNavigateProtocolUrl: vi.fn(),
    handleProvidersProtocolUrl: vi.fn()
  }
  const windowManagerMock = {
    broadcast: vi.fn(),
    getWindow: vi.fn(),
    getWindowIdByWebContents: vi.fn(),
    onWindowDestroyed: vi.fn()
  }
  const protocolWindowWebContentsMock = {
    send: vi.fn(),
    isDestroyed: vi.fn()
  }
  const protocolWindowMock = {
    isDestroyed: vi.fn(),
    webContents: protocolWindowWebContentsMock
  }
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const cherryInOauthServiceMock = {
    handleOAuthCallback: vi.fn()
  }
  return {
    appMock,
    cherryInOauthServiceMock,
    execFileMock: vi.fn(),
    fsPromisesMock: {
      writeFile: vi.fn()
    },
    handlersMock,
    ipcHandlers: new Map<string, (...args: any[]) => any>(),
    loggerMock,
    mainWindowServiceMock,
    platformMock: {
      isLinux: false
    },
    protocolWindowMock,
    protocolWindowWebContentsMock,
    windowManagerMock
  }
})

vi.mock('electron', () => ({ app: appMock }))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

vi.mock('node:fs/promises', () => ({
  default: fsPromisesMock,
  ...fsPromisesMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'MainWindowService') return mainWindowServiceMock
      if (name === 'CherryInOauthService') return cherryInOauthServiceMock
      throw new Error(`unexpected service: ${name}`)
    },
    getPath: (key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`)
  }
}))

vi.mock('@main/core/platform', () => ({
  get isLinux() {
    return platformMock.isLinux
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected registerDisposable<T>(disposable: T): T {
      return disposable
    }

    protected ipcHandle(channel: string, listener: (...args: any[]) => any) {
      ipcHandlers.set(channel, listener)
      return { dispose: vi.fn() }
    }
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background' }
  }
})

vi.mock('../handlers/mcpInstall', () => ({
  handleMcpProtocolUrl: handlersMock.handleMcpProtocolUrl
}))

vi.mock('../handlers/navigate', () => ({
  handleNavigateProtocolUrl: handlersMock.handleNavigateProtocolUrl
}))

vi.mock('../handlers/providersImport', () => ({
  handleProvidersProtocolUrl: handlersMock.handleProvidersProtocolUrl
}))

import { IpcChannel } from '@shared/IpcChannel'

import { ProtocolService } from '../ProtocolService'

describe('ProtocolService', () => {
  let service: ProtocolService
  let originalArgv: string[]
  let originalAppImage: string | undefined
  let originalDefaultApp: boolean | undefined

  function setDefaultApp(value: boolean | undefined) {
    if (value === undefined) {
      Reflect.deleteProperty(process, 'defaultApp')
    } else {
      ;(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp = value
    }
  }

  beforeEach(() => {
    originalArgv = process.argv
    originalAppImage = process.env.APPIMAGE
    originalDefaultApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp
    vi.clearAllMocks()
    ipcHandlers.clear()
    platformMock.isLinux = false
    fsPromisesMock.writeFile.mockResolvedValue(undefined)
    execFileMock.mockImplementation((_file, _args, callback) => callback(null, '', ''))
    cherryInOauthServiceMock.handleOAuthCallback.mockResolvedValue(undefined)
    protocolWindowMock.isDestroyed.mockReturnValue(false)
    protocolWindowWebContentsMock.isDestroyed.mockReturnValue(false)
    windowManagerMock.getWindow.mockReturnValue(protocolWindowMock)
    windowManagerMock.getWindowIdByWebContents.mockReturnValue('window-1')
    windowManagerMock.onWindowDestroyed.mockReturnValue({ dispose: vi.fn() })
    handlersMock.handleMcpProtocolUrl.mockResolvedValue(undefined)
    handlersMock.handleProvidersProtocolUrl.mockResolvedValue(undefined)
    service = new ProtocolService()
  })

  afterEach(() => {
    process.argv = originalArgv
    if (originalAppImage === undefined) {
      Reflect.deleteProperty(process.env, 'APPIMAGE')
    } else {
      process.env.APPIMAGE = originalAppImage
    }
    setDefaultApp(originalDefaultApp)
  })

  it('logs malformed protocol URLs instead of throwing', () => {
    expect(() => (service as any).handleProtocolUrl('not a url')).not.toThrow()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle protocol URL', expect.any(TypeError))
  })

  it('registers the packaged protocol handler without dev arguments', async () => {
    setDefaultApp(false)
    process.argv = ['Cherry Studio.exe']

    await (service as any).onInit()

    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledWith('cherrystudio')
  })

  it('registers the dev protocol handler with an absolute app entry', async () => {
    setDefaultApp(true)
    process.argv = ['electron.exe', '.']

    await (service as any).onInit()

    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledWith('cherrystudio', process.execPath, [
      path.resolve(process.cwd(), '.')
    ])
  })

  it('logs asynchronous providers handler failures', async () => {
    const error = new Error('failed')
    handlersMock.handleProvidersProtocolUrl.mockRejectedValueOnce(error)

    ;(service as any).handleProtocolUrl('cherrystudio://providers/api-keys?v=1&data=abc')

    await vi.waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle providers protocol URL', error)
    })
  })

  it('logs asynchronous MCP handler failures', async () => {
    const error = new Error('failed')
    handlersMock.handleMcpProtocolUrl.mockRejectedValueOnce(error)

    ;(service as any).handleProtocolUrl('cherrystudio://mcp/install?servers=abc')

    await vi.waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle MCP protocol URL', error)
    })
  })

  it('handles cold-start protocol argv case-insensitively', async () => {
    setDefaultApp(false)
    process.argv = ['Cherry Studio.exe', 'CherryStudio://oauth/callback?code=abc']

    await (service as any).onInit()

    expect(cherryInOauthServiceMock.handleOAuthCallback).toHaveBeenCalledTimes(1)
    const url = cherryInOauthServiceMock.handleOAuthCallback.mock.calls[0][0] as URL
    expect(url.href).toBe('cherrystudio://oauth/callback?code=abc')
  })

  it('broadcasts unknown protocol hosts without query params', () => {
    ;(service as any).handleProtocolUrl('cherrystudio://unknown/path?code=secret&foo=bar#token')

    expect(windowManagerMock.broadcast).toHaveBeenCalledWith(IpcChannel.Protocol_Data, {
      url: 'cherrystudio://unknown/path',
      params: {}
    })
  })

  it('delivers registered sensitive protocol hosts only to the registered window', async () => {
    await (service as any).onInit()
    const register = ipcHandlers.get(IpcChannel.Protocol_RegisterHostListener)
    if (!register) throw new Error('register handler missing')

    await register({ sender: {} }, 'ppio')

    ;(service as any).handleProtocolUrl('cherrystudio://ppio/callback?code=abc&state=xyz')

    expect(protocolWindowWebContentsMock.send).toHaveBeenCalledWith(IpcChannel.Protocol_Data, {
      url: 'cherrystudio://ppio/callback?code=abc&state=xyz',
      params: { code: 'abc', state: 'xyz' }
    })
    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
  })

  it('queues sensitive protocol callbacks until a listener registers', async () => {
    await (service as any).onInit()
    ;(service as any).handleProtocolUrl('cherrystudio://nutstore/callback?s=encrypted-token')

    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
    expect(protocolWindowWebContentsMock.send).not.toHaveBeenCalled()

    const register = ipcHandlers.get(IpcChannel.Protocol_RegisterHostListener)
    if (!register) throw new Error('register handler missing')

    expect(await register({ sender: {} }, 'nutstore')).toEqual({ host: 'nutstore', deliveredPending: 1 })

    expect(protocolWindowWebContentsMock.send).toHaveBeenCalledWith(IpcChannel.Protocol_Data, {
      url: 'cherrystudio://nutstore/callback?s=encrypted-token',
      params: { s: 'encrypted-token' }
    })
    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
  })

  it('removes registered protocol host listeners on cleanup', async () => {
    await (service as any).onInit()
    const register = ipcHandlers.get(IpcChannel.Protocol_RegisterHostListener)
    const unregister = ipcHandlers.get(IpcChannel.Protocol_UnregisterHostListener)
    if (!register || !unregister) throw new Error('protocol host handlers missing')

    await register({ sender: {} }, 'nutstore')
    expect(await unregister({ sender: {} }, 'nutstore')).toBe(true)

    ;(service as any).handleProtocolUrl('cherrystudio://nutstore/callback?s=encrypted-token')

    expect(protocolWindowWebContentsMock.send).not.toHaveBeenCalled()
    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
  })

  it('keeps a protocol host listener active until every registration is cleaned up', async () => {
    await (service as any).onInit()
    const register = ipcHandlers.get(IpcChannel.Protocol_RegisterHostListener)
    const unregister = ipcHandlers.get(IpcChannel.Protocol_UnregisterHostListener)
    if (!register || !unregister) throw new Error('protocol host handlers missing')

    await register({ sender: {} }, 'ppio')
    await register({ sender: {} }, 'ppio')
    expect(await unregister({ sender: {} }, 'ppio')).toBe(true)

    ;(service as any).handleProtocolUrl('cherrystudio://ppio/callback?code=abc')

    expect(protocolWindowWebContentsMock.send).toHaveBeenCalledWith(IpcChannel.Protocol_Data, {
      url: 'cherrystudio://ppio/callback?code=abc',
      params: { code: 'abc' }
    })
    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()

    protocolWindowWebContentsMock.send.mockClear()
    expect(await unregister({ sender: {} }, 'ppio')).toBe(true)

    ;(service as any).handleProtocolUrl('cherrystudio://ppio/callback?code=def')

    expect(protocolWindowWebContentsMock.send).not.toHaveBeenCalled()
    expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
  })

  it('updates the AppImage desktop database without shell command construction', async () => {
    platformMock.isLinux = true
    process.env.APPIMAGE = '/mock/Cherry Studio Pi.AppImage'

    await (service as any).onAllReady()

    expect(fsPromisesMock.writeFile).toHaveBeenCalledWith(
      '/mock/feature.protocol.desktop_entries/cherrystudio-url-handler.desktop',
      expect.stringContaining('Name=Cherry Studio Pi\nExec="/mock/app.exe_file" %U'),
      'utf-8'
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'update-desktop-database',
      ['/mock/feature.protocol.desktop_entries'],
      expect.any(Function)
    )
  })

  describe('second-instance handler', () => {
    function getSecondInstanceHandler() {
      const call = appMock.on.mock.calls.find((call) => call[0] === 'second-instance')
      if (!call) throw new Error('second-instance listener not registered')
      return call[1] as (event: unknown, argv: string[]) => void
    }

    it('dispatches the URL when argv carries a cherrystudio:// deep link', async () => {
      await (service as any).onInit()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.', 'cherrystudio://oauth/callback?code=abc'])

      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
      expect(cherryInOauthServiceMock.handleOAuthCallback).toHaveBeenCalledTimes(1)
      const url = cherryInOauthServiceMock.handleOAuthCallback.mock.calls[0][0] as URL
      expect(url.href).toBe('cherrystudio://oauth/callback?code=abc')
      expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
    })

    it('dispatches second-instance protocol URLs case-insensitively', async () => {
      await (service as any).onInit()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.', 'CherryStudio://oauth/callback?code=abc'])

      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
      expect(cherryInOauthServiceMock.handleOAuthCallback).toHaveBeenCalledTimes(1)
      const url = cherryInOauthServiceMock.handleOAuthCallback.mock.calls[0][0] as URL
      expect(url.href).toBe('cherrystudio://oauth/callback?code=abc')
    })

    it('surfaces the main window when argv has no protocol URL', async () => {
      await (service as any).onInit()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.'])

      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
      expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
    })
  })
})
