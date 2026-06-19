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
  isSensitiveAgentKey: (key: string) => {
    const normalized = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_./:\-\s]+/g, ' ')
      .trim()
      .toLowerCase()
    if (
      /\b(?:token|tokens)\s+(?:count|counts|used|usage|total|prompt|completion|input|output|estimated|remaining|limit|limits)\b|^(?:total|prompt|completion|input|output|estimated|remaining|max)\s+tokens?\b/.test(
        normalized
      )
    ) {
      return false
    }
    return /\b(?:api keys?|private keys?|access keys?|tokens?|secrets?|passwords?|passwd|passphrases?|passcodes?|pass|authorizations?|credentials?|cookies?)\b/.test(
      normalized
    )
  },
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
      passage: 'visible passage',
      compass: 'visible compass',
      bypassReason: 'visible bypass reason',
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
          passage: 'visible passage',
          compass: 'visible compass',
          bypassReason: 'visible bypass reason',
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

  it('keeps non-secret setting paths containing pass visible', async () => {
    const passage = await capability('settings.value.get').execute({ path: 'passage' }, { source: 'agent' })
    const compass = await capability('settings.value.get').execute({ path: 'compass' }, { source: 'agent' })
    const bypassReason = await capability('settings.value.get').execute({ path: 'bypassReason' }, { source: 'agent' })

    expect(passage.data).toEqual({
      path: 'passage',
      value: 'visible passage'
    })
    expect(compass.data).toEqual({
      path: 'compass',
      value: 'visible compass'
    })
    expect(bypassReason.data).toEqual({
      path: 'bypassReason',
      value: 'visible bypass reason'
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
      passage: 'visible passage',
      compass: 'visible compass',
      bypassReason: 'visible bypass reason',
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

  it('declares setting writes as side-effecting operations', () => {
    expect(capability('settings.value.set')).toMatchObject({
      permissions: ['settings.write'],
      sideEffects: ['settings.write']
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

  it('rejects unsupported runtime-only setting updates before dispatching', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) throw new Error('renderer asleep')
      return undefined
    })

    await expect(
      capability('settings.value.set').execute({ path: 'showAssistants', value: false }, { source: 'agent' })
    ).rejects.toThrow('Unsupported setting path: showAssistants')

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('keeps preference-backed updates when runtime refresh times out', async () => {
    vi.useFakeTimers()
    try {
      mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation((script: string) => {
        if (script.includes('typeof')) return Promise.resolve(true)
        if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) return new Promise(() => undefined)
        return Promise.resolve(undefined)
      })

      const update = capability('settings.value.set').execute(
        { path: 'defaultPaintingProvider', value: 'ppio' },
        { source: 'agent' }
      )

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(update).resolves.toMatchObject({
        ok: true,
        data: {
          path: 'defaultPaintingProvider',
          value: 'ppio'
        }
      })
    } finally {
      vi.useRealTimers()
    }

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.paintings.default_provider', 'ppio')
  })

  it('updates preference-backed assistant list click behavior', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'clickAssistantToShowTopic', value: true },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('assistant.click_to_show_topic', true)
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(result.data).toEqual({
      path: 'clickAssistantToShowTopic',
      value: true
    })
  })

  it('persists migrated settings through the preference service without dispatching inactive legacy actions', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'theme', value: 'light' },
      { source: 'agent' }
    )

    expect(mocks.preferenceService.set).toHaveBeenCalledWith('ui.theme_mode', 'light')
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
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
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
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

  it('rejects non-string setting paths without reading or writing settings', async () => {
    await expect(capability('settings.value.get').execute({ path: ['theme'] }, { source: 'agent' })).rejects.toThrow(
      'Setting path must be a string'
    )
    await expect(
      capability('settings.value.set').execute({ path: { key: 'theme' }, value: 'dark' }, { source: 'agent' })
    ).rejects.toThrow('Setting path must be a string')

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects empty setting update paths without dispatching', async () => {
    await expect(
      capability('settings.value.set').execute({ path: '   ', value: 'dark' }, { source: 'agent' })
    ).rejects.toThrow('Setting path is required')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects missing setting update values without writing undefined', async () => {
    await expect(capability('settings.value.set').execute({ path: 'theme' }, { source: 'agent' })).rejects.toThrow(
      'Setting value is required'
    )

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects non-object settings capability inputs before reads, writes, or navigation', async () => {
    await expect(capability('settings.sections.list').execute('sections' as any, { source: 'agent' })).rejects.toThrow(
      'Settings capability input must be an object'
    )
    await expect(capability('settings.read').execute(['settings'] as any, { source: 'agent' })).rejects.toThrow(
      'Settings capability input must be an object'
    )
    await expect(capability('settings.value.get').execute(true as any, { source: 'agent' })).rejects.toThrow(
      'Settings capability input must be an object'
    )
    await expect(capability('settings.value.set').execute('theme' as any, { source: 'agent' })).rejects.toThrow(
      'Settings capability input must be an object'
    )
    await expect(capability('settings.open').execute(['data'] as any, { source: 'agent' })).rejects.toThrow(
      'Settings capability input must be an object'
    )

    expect(mocks.preferenceService.get).not.toHaveBeenCalled()
    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.navigateApp).not.toHaveBeenCalled()
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

  it('keeps settings route query strings while opening explicit settings routes', async () => {
    const result = await capability('settings.open').execute(
      { route: 'settings/provider?id=openai' },
      { source: 'agent' }
    )

    expect(mocks.navigateApp).toHaveBeenCalledWith('/settings/provider?id=openai')
    expect(result.data).toEqual({ route: '/settings/provider?id=openai' })
  })

  it('rejects non-settings routes through the settings opener', async () => {
    await expect(capability('settings.open').execute({ route: '/agents' }, { source: 'agent' })).rejects.toThrow(
      'Unsupported settings route: /agents'
    )

    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })

  it('rejects invalid settings opener inputs instead of opening the default section', async () => {
    await expect(capability('settings.open').execute({ section: ['data'] }, { source: 'agent' })).rejects.toThrow(
      'Settings section must be a string'
    )
    await expect(capability('settings.open').execute({ section: 'unknown' }, { source: 'agent' })).rejects.toThrow(
      'Unsupported settings section: unknown'
    )
    await expect(
      capability('settings.open').execute({ route: { path: '/settings/data' } }, { source: 'agent' })
    ).rejects.toThrow('Settings route must be a string')

    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })
})
