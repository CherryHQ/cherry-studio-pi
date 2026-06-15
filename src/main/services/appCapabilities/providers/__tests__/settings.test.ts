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
  reduxService: {
    select: vi.fn(),
    dispatch: vi.fn()
  },
  preferenceService: {
    get: vi.fn(),
    set: vi.fn()
  },
  navigateApp: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return mocks.preferenceService
      throw new Error(`Unknown service: ${name}`)
    })
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: mocks.reduxService
}))

vi.mock('../../utils', () => ({
  navigateApp: mocks.navigateApp,
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  pickPath: (value: any, keyPath = '') =>
    keyPath ? keyPath.split('.').reduce((current, key) => current?.[key], value) : value,
  sanitizeForAgent: (value: unknown) => value
}))

import { RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE, RENDERER_GET_SETTINGS_BRIDGE } from '@shared/settingsBridge'

import { createSettingsCapabilities } from '../settings'

function capability(id: string) {
  const item = createSettingsCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('settings app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.reduxService.select.mockResolvedValue({
      defaultPaintingProvider: 'silicon',
      theme: 'dark',
      apiServer: {
        host: '127.0.0.1',
        port: 23333,
        enabled: false,
        apiKey: 'server-secret'
      },
      serviceAccount: {
        privateKey: '-----BEGIN PRIVATE KEY-----'
      },
      webdavPass: 'dav-secret'
    })
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_SETTINGS_BRIDGE)) {
        return {
          defaultPaintingProvider: 'silicon',
          theme: 'dark',
          apiServer: {
            host: '127.0.0.1',
            port: 23333,
            enabled: false,
            apiKey: 'server-secret'
          },
          serviceAccount: {
            privateKey: '-----BEGIN PRIVATE KEY-----'
          },
          webdavPass: 'dav-secret'
        }
      }
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) return {}
      return undefined
    })
    mocks.preferenceService.get.mockImplementation((key: string) => {
      const preferences: Record<string, unknown> = {
        'app.language': 'zh-CN',
        'app.tray.enabled': true,
        'app.tray.on_close': false,
        'assistant.click_to_show_topic': false,
        'chat.message.confirm_delete': false,
        'data.backup.webdav.host': 'https://dav.example.com',
        'data.backup.webdav.pass': 'preference-dav-secret',
        'feature.api_gateway.enabled': true,
        'feature.api_gateway.host': '0.0.0.0',
        'feature.api_gateway.port': 24444,
        'feature.api_gateway.api_key': 'preference-server-secret',
        'feature.paintings.default_provider': 'openai',
        'topic.tab.show': false,
        'ui.theme_mode': 'system'
      }
      return preferences[key]
    })
    mocks.preferenceService.set.mockResolvedValue(undefined)
  })

  function findSettingsDispatchScript() {
    return mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.find(([script]) =>
      String(script).startsWith(`window[${JSON.stringify(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)}](`)
    )?.[0]
  }

  it('reads a single setting value by path', async () => {
    const result = await capability('settings.value.get').execute({ path: 'apiServer.port' }, { source: 'agent' })

    expect(result).toEqual({
      ok: true,
      summary: 'Setting value read',
      data: {
        path: 'apiServer.port',
        value: 24444
      }
    })
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('feature.api_gateway.port')
  })

  it('reads preference-backed default painting provider by path', async () => {
    const result = await capability('settings.value.get').execute(
      { path: 'defaultPaintingProvider' },
      { source: 'agent' }
    )

    expect(result.data).toEqual({
      path: 'defaultPaintingProvider',
      value: 'openai'
    })
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('feature.paintings.default_provider')
  })

  it('reads preference-backed assistant list click behavior by path', async () => {
    const result = await capability('settings.value.get').execute(
      { path: 'clickAssistantToShowTopic' },
      { source: 'agent' }
    )

    expect(result.data).toEqual({
      path: 'clickAssistantToShowTopic',
      value: false
    })
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('assistant.click_to_show_topic')
  })

  it('reads migrated preference-backed settings instead of stale redux snapshot values', async () => {
    const theme = await capability('settings.value.get').execute({ path: 'theme' }, { source: 'agent' })
    const showTopics = await capability('settings.value.get').execute({ path: 'showTopics' }, { source: 'agent' })
    const webdavHost = await capability('settings.value.get').execute({ path: 'webdavHost' }, { source: 'agent' })

    expect(theme.data).toEqual({
      path: 'theme',
      value: 'system'
    })
    expect(showTopics.data).toEqual({
      path: 'showTopics',
      value: false
    })
    expect(webdavHost.data).toEqual({
      path: 'webdavHost',
      value: 'https://dav.example.com'
    })
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('ui.theme_mode')
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('topic.tab.show')
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('data.backup.webdav.host')
  })

  it('redacts sensitive single setting values by path', async () => {
    const apiKey = await capability('settings.value.get').execute({ path: 'apiServer.apiKey' }, { source: 'agent' })
    const webdavPass = await capability('settings.value.get').execute({ path: 'webdavPass' }, { source: 'agent' })
    const privateKey = await capability('settings.value.get').execute(
      { path: 'serviceAccount.privateKey' },
      { source: 'agent' }
    )

    expect(apiKey.data).toEqual({
      path: 'apiServer.apiKey',
      value: '[redacted]'
    })
    expect(webdavPass.data).toEqual({
      path: 'webdavPass',
      value: '[redacted]'
    })
    expect(privateKey.data).toEqual({
      path: 'serviceAccount.privateKey',
      value: '[redacted]'
    })
  })

  it('redacts sensitive values when reading the full settings snapshot', async () => {
    const result = await capability('settings.read').execute({}, { source: 'agent' })
    const data = result.data as { settings: Record<string, unknown> }

    expect(data.settings).toMatchObject({
      apiServer: {
        apiKey: '[redacted]',
        port: 24444
      },
      serviceAccount: {
        privateKey: '[redacted]'
      },
      webdavPass: '[redacted]',
      theme: 'system'
    })
    expect(JSON.stringify(data.settings)).not.toContain('server-secret')
    expect(JSON.stringify(data.settings)).not.toContain('preference-dav-secret')
    expect(JSON.stringify(data.settings)).not.toContain('BEGIN PRIVATE KEY')
  })

  it('redacts sensitive setting update values in the agent response only', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'apiServer.apiKey', value: 'new-server-secret' },
      { source: 'agent' }
    )

    expect(findSettingsDispatchScript()).toContain('"type":"settings/setApiServerApiKey"')
    expect(findSettingsDispatchScript()).toContain('"payload":"new-server-secret"')
    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.api_gateway.api_key', 'new-server-secret')
    expect(result.data).toEqual({
      path: 'apiServer.apiKey',
      value: '[redacted]'
    })
  })

  it('normalizes setting update paths before dispatching', async () => {
    const result = await capability('settings.value.set').execute(
      { path: ' apiServer.port ', value: 23334 },
      { source: 'agent' }
    )

    expect(findSettingsDispatchScript()).toContain('"type":"settings/setApiServerPort"')
    expect(findSettingsDispatchScript()).toContain('"payload":23334')
    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.api_gateway.port', 23334)
    expect(result.data).toEqual({
      path: 'apiServer.port',
      value: 23334
    })
  })

  it('updates preference-only api server settings', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'apiServer.host', value: '0.0.0.0' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.api_gateway.host', '0.0.0.0')
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(result.data).toEqual({
      path: 'apiServer.host',
      value: '0.0.0.0'
    })
  })

  it('updates preference-backed default painting provider settings', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'defaultPaintingProvider', value: 'ppio' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.paintings.default_provider', 'ppio')
    expect(findSettingsDispatchScript()).toContain('"type":"settings/setDefaultPaintingProvider"')
    expect(findSettingsDispatchScript()).toContain('"payload":"ppio"')
    expect(result.data).toEqual({
      path: 'defaultPaintingProvider',
      value: 'ppio'
    })
  })

  it('keeps preference-backed updates when the renderer runtime dispatch is unavailable', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) throw new Error('renderer asleep')
      return undefined
    })

    const result = await capability('settings.value.set').execute(
      { path: 'defaultPaintingProvider', value: 'ppio' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.paintings.default_provider', 'ppio')
    expect(result.data).toEqual({
      path: 'defaultPaintingProvider',
      value: 'ppio'
    })
  })

  it('rejects runtime-only setting updates when the renderer runtime dispatch fails', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) throw new Error('renderer asleep')
      return undefined
    })

    await expect(
      capability('settings.value.set').execute({ path: 'showAssistants', value: false }, { source: 'agent' })
    ).rejects.toThrow('Failed to write runtime setting: renderer asleep')

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
  })

  it('updates preference-backed assistant list click behavior', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'clickAssistantToShowTopic', value: true },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('assistant.click_to_show_topic', true)
    expect(findSettingsDispatchScript()).toContain('"type":"settings/setClickAssistantToShowTopic"')
    expect(findSettingsDispatchScript()).toContain('"payload":true')
    expect(result.data).toEqual({
      path: 'clickAssistantToShowTopic',
      value: true
    })
  })

  it('persists migrated settings through the preference service before dispatching legacy actions', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'theme', value: 'light' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('ui.theme_mode', 'light')
    expect(findSettingsDispatchScript()).toContain('"type":"settings/setTheme"')
    expect(findSettingsDispatchScript()).toContain('"payload":"light"')
    expect(result.data).toEqual({
      path: 'theme',
      value: 'light'
    })
  })

  it('persists migrated sensitive settings while redacting the returned value', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'webdavPass', value: 'new-dav-secret' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('data.backup.webdav.pass', 'new-dav-secret')
    expect(findSettingsDispatchScript()).toContain('"type":"settings/setWebdavPass"')
    expect(findSettingsDispatchScript()).toContain('"payload":"new-dav-secret"')
    expect(result.data).toEqual({
      path: 'webdavPass',
      value: '[redacted]'
    })
  })

  it('rejects empty setting paths without reading all settings', async () => {
    await expect(capability('settings.value.get').execute({ path: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Setting path is required'
    )

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects empty setting update paths without dispatching', async () => {
    await expect(
      capability('settings.value.set').execute({ path: '   ', value: 'dark' }, { source: 'agent' })
    ).rejects.toThrow('Setting path is required')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('normalizes settings section and route inputs before opening', async () => {
    const bySection = await capability('settings.open').execute({ section: ' data ' }, { source: 'agent' })

    expect(mocks.navigateApp).toHaveBeenCalledWith('/settings/data')
    expect(bySection.data).toEqual({ route: '/settings/data' })

    mocks.navigateApp.mockClear()

    const byRoute = await capability('settings.open').execute({ route: ' /settings/about ' }, { source: 'agent' })

    expect(mocks.navigateApp).toHaveBeenCalledWith('/settings/about')
    expect(byRoute.data).toEqual({ route: '/settings/about' })
  })
})
