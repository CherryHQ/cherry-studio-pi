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

vi.mock('../../utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    navigateApp: mocks.navigateApp,
    okResult: (summary: string, data?: unknown) => ({
      ok: true,
      summary,
      ...(data === undefined ? {} : { data })
    }),
    pickPath: (value: any, keyPath = '') =>
      keyPath ? keyPath.split('.').reduce((current, key) => current?.[key], value) : value,
    sanitizeForAgent: (value: unknown) => value
  }
})

import { RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE, RENDERER_GET_SETTINGS_BRIDGE } from '@shared/settingsBridge'
import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'

import { createPaintingCapabilities } from '../paintings'

function capability(id: string) {
  const item = createPaintingCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

const paintingState = {
  siliconflow_paintings: [
    {
      id: 'silicon-1',
      prompt: 'draw a quiet desk',
      negativePrompt: 'blur',
      model: 'sdxl',
      urls: ['https://example.com/image.png'],
      files: [{ id: 'file-1', name: 'image.png', ext: '.png', type: 'image', size: 1024 }],
      imageFile: `data:image/png;base64,${'x'.repeat(20_000)}`
    },
    {
      id: 'silicon-2',
      prompt: 'draw a studio',
      urls: [],
      files: []
    }
  ],
  dmxapi_paintings: [
    {
      id: 'dmx-1',
      prompt: 'draw a product',
      image_size: '1024x1024',
      extend_params: { raw: 'large-provider-payload' },
      urls: [],
      files: []
    }
  ]
}

describe('painting app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.reduxService.select.mockImplementation(async (path: string) => {
      if (path === 'state.paintings') return paintingState
      if (path === 'state.settings') return { defaultPaintingProvider: 'silicon' }
      return null
    })
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE)) return paintingState
      if (script.includes(RENDERER_GET_SETTINGS_BRIDGE)) return { defaultPaintingProvider: 'silicon' }
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) return {}
      return undefined
    })
    mocks.preferenceService.get.mockImplementation((key: string) => {
      if (key === 'feature.paintings.default_provider') return 'openai'
      return undefined
    })
    mocks.preferenceService.set.mockResolvedValue(undefined)
  })

  it('lists the v2 preference-backed default painting provider', async () => {
    const result = await capability('paintings.providers.list').execute({}, { source: 'agent' })

    expect(result.data).toEqual({
      defaultProvider: 'openai',
      namespaces: expect.arrayContaining(['openai_image_generate'])
    })
    expect(mocks.preferenceService.get).toHaveBeenCalledWith('feature.paintings.default_provider')
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('lists painting history as compact paged summaries by default', async () => {
    const result = await capability('paintings.history.list').execute({ limit: 1 }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      total: 3,
      limit: 1,
      offset: 0,
      nextOffset: 1,
      compacted: true,
      counts: {
        siliconflow_paintings: 2,
        dmxapi_paintings: 1
      }
    })
    expect((result.data as any).paintings).toEqual([
      expect.objectContaining({
        namespace: 'siliconflow_paintings',
        id: 'silicon-1',
        prompt: 'draw a quiet desk',
        urlsCount: 1,
        filesCount: 1
      })
    ])
    expect((result.data as any).paintings[0]).not.toHaveProperty('imageFile')
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `window[${JSON.stringify(RENDERER_GET_STORE_VALUE_BRIDGE)}]({"path":"state.paintings"})`
    )
  })

  it('stops painting history reads when the capability signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped')

    await expect(
      capability('paintings.history.list').execute({ limit: 1 }, { source: 'agent', signal: controller.signal })
    ).rejects.toThrow('agent stopped')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('stops painting capabilities before side effects when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped painting work')
    const context = { source: 'agent' as const, signal: controller.signal }

    await expect(capability('paintings.providers.list').execute({}, context)).rejects.toThrow(
      'agent stopped painting work'
    )
    await expect(capability('paintings.defaultProvider.set').execute({ provider: 'openai' }, context)).rejects.toThrow(
      'agent stopped painting work'
    )
    await expect(capability('paintings.open').execute({ provider: 'openai' }, context)).rejects.toThrow(
      'agent stopped painting work'
    )
    await expect(
      capability('paintings.image.generate').execute({ prompt: 'draw a cat', provider: 'openai' }, context)
    ).rejects.toThrow('agent stopped painting work')

    expect(mocks.preferenceService.get).not.toHaveBeenCalled()
    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.navigateApp).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('does not return stale painting results when cancellation happens during side effects', async () => {
    const providerController = new AbortController()
    mocks.preferenceService.get.mockImplementationOnce(() => {
      providerController.abort('agent cancelled while reading painting provider')
      return 'openai'
    })

    await expect(
      capability('paintings.providers.list').execute({}, { source: 'agent', signal: providerController.signal })
    ).rejects.toThrow('agent cancelled while reading painting provider')

    const openController = new AbortController()
    mocks.navigateApp.mockImplementationOnce(async () => {
      openController.abort(new Error('agent cancelled during painting navigation'))
    })

    await expect(
      capability('paintings.open').execute({ provider: 'openai' }, { source: 'agent', signal: openController.signal })
    ).rejects.toThrow('agent cancelled during painting navigation')

    const generateController = new AbortController()
    mocks.navigateApp.mockImplementationOnce(async () => {
      generateController.abort('agent cancelled during painting generation')
    })

    await expect(
      capability('paintings.image.generate').execute(
        { prompt: 'draw a cat', provider: 'openai' },
        { source: 'agent', signal: generateController.signal }
      )
    ).rejects.toThrow('agent cancelled during painting generation')
  })

  it('supports namespace and offset pagination for painting history', async () => {
    const result = await capability('paintings.history.list').execute(
      { namespace: 'siliconflow_paintings', limit: 1, offset: 1 },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      namespace: 'siliconflow_paintings',
      total: 2,
      limit: 1,
      offset: 1,
      nextOffset: null
    })
    expect((result.data as any).paintings).toEqual([
      expect.objectContaining({
        namespace: 'siliconflow_paintings',
        id: 'silicon-2'
      })
    ])
  })

  it('normalizes painting history namespace filters', async () => {
    const result = await capability('paintings.history.list').execute(
      { namespace: ' siliconflow_paintings ', limit: 1 },
      { source: 'agent' }
    )

    expect(result.data).toMatchObject({
      namespace: 'siliconflow_paintings',
      total: 2
    })
  })

  it('rejects invalid painting history namespaces before reading renderer state', async () => {
    await expect(
      capability('paintings.history.list').execute({ namespace: ['siliconflow_paintings'] }, { source: 'agent' })
    ).rejects.toThrow('绘图命名空间必须是字符串。')
    await expect(
      capability('paintings.history.list').execute({ namespace: 'missing_namespace' }, { source: 'agent' })
    ).rejects.toThrow('不支持的绘图命名空间：missing_namespace')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects invalid painting history pagination shapes before reading renderer state', async () => {
    await expect(capability('paintings.history.list').execute({ limit: true }, { source: 'agent' })).rejects.toThrow(
      '绘图历史数量必须是数字。'
    )
    await expect(capability('paintings.history.list').execute({ offset: ['1'] }, { source: 'agent' })).rejects.toThrow(
      '绘图历史偏移量必须是数字。'
    )

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects non-object painting capability inputs before side effects', async () => {
    await expect(
      capability('paintings.providers.list').execute('providers' as any, { source: 'agent' })
    ).rejects.toThrow('绘图能力的输入必须是对象。')
    await expect(capability('paintings.history.list').execute(['history'] as any, { source: 'agent' })).rejects.toThrow(
      '绘图能力的输入必须是对象。'
    )
    await expect(
      capability('paintings.defaultProvider.set').execute(false as any, { source: 'agent' })
    ).rejects.toThrow('绘图能力的输入必须是对象。')
    await expect(capability('paintings.open').execute(['open'] as any, { source: 'agent' })).rejects.toThrow(
      '绘图能力的输入必须是对象。'
    )
    await expect(
      capability('paintings.image.generate').execute('draw a cat' as any, { source: 'agent' })
    ).rejects.toThrow('绘图能力的输入必须是对象。')

    expect(mocks.preferenceService.get).not.toHaveBeenCalled()
    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.navigateApp).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('returns raw painting history only when explicitly requested', async () => {
    const result = await capability('paintings.history.list').execute(
      { namespace: 'siliconflow_paintings', limit: 1, includeRaw: true },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ compacted: false })
    expect((result.data as any).paintings[0]).toMatchObject({
      namespace: 'siliconflow_paintings',
      id: 'silicon-1',
      imageFile: expect.stringContaining('data:image/png;base64')
    })
    expect(((result.data as any).paintings[0].imageFile as string).length).toBeLessThan(2_100)
    expect((result.data as any).paintings[0].imageFile).toContain('[truncated ')
    expect((result.data as any).paintings[0].imageFile).not.toContain('x'.repeat(5_000))
  })

  it('bounds compact painting file previews before returning them to agents', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE)) {
        return {
          siliconflow_paintings: [
            {
              id: 'many-files',
              files: Array.from({ length: 30 }, (_, index) => ({ id: `file-${index}`, name: `file-${index}.png` }))
            }
          ]
        }
      }
      if (script.includes(RENDERER_GET_SETTINGS_BRIDGE)) return { defaultPaintingProvider: 'silicon' }
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) return {}
      return undefined
    })

    const result = await capability('paintings.history.list').execute(
      { namespace: 'siliconflow_paintings' },
      { source: 'agent' }
    )

    expect((result.data as any).paintings[0]).toMatchObject({
      id: 'many-files',
      filesCount: 30,
      filesTruncated: 10
    })
    expect((result.data as any).paintings[0].files).toHaveLength(20)
    expect((result.data as any).paintings[0].files.at(-1)).toEqual({
      id: 'file-19',
      name: 'file-19.png',
      type: undefined,
      ext: undefined,
      size: undefined
    })
  })

  it('bounds raw painting arrays before returning them to agents', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE)) {
        return {
          siliconflow_paintings: [
            {
              id: 'many-files',
              files: Array.from({ length: 30 }, (_, index) => ({ id: `file-${index}` }))
            }
          ]
        }
      }
      if (script.includes(RENDERER_GET_SETTINGS_BRIDGE)) return { defaultPaintingProvider: 'silicon' }
      if (script.includes(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)) return {}
      return undefined
    })

    const result = await capability('paintings.history.list').execute(
      { namespace: 'siliconflow_paintings', includeRaw: true },
      { source: 'agent' }
    )

    expect((result.data as any).paintings[0].files).toHaveLength(21)
    expect((result.data as any).paintings[0].files.at(-1)).toBe('[...truncated 10 items...]')
  })

  it('normalizes painting provider updates', async () => {
    const result = await capability('paintings.defaultProvider.set').execute(
      { provider: ' openai ' },
      { source: 'agent' }
    )

    const dispatchScript = mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.find(([script]) =>
      String(script).startsWith(`window[${JSON.stringify(RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE)}](`)
    )?.[0]
    expect(dispatchScript).toContain('"type":"settings/setDefaultPaintingProvider"')
    expect(dispatchScript).toContain('"payload":"openai"')
    expect(mocks.preferenceService.set).toHaveBeenCalledWith('feature.paintings.default_provider', 'openai')
    expect(result.data).toEqual({ defaultProvider: 'openai' })
  })

  it('declares painting provider updates as setting side effects', () => {
    expect(capability('paintings.defaultProvider.set')).toMatchObject({
      permissions: ['paintings.write'],
      sideEffects: ['settings.write']
    })
  })

  it('rejects empty painting provider updates', async () => {
    await expect(
      capability('paintings.defaultProvider.set').execute({ provider: '   ' }, { source: 'agent' })
    ).rejects.toThrow('绘图服务商不能为空。')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejects route-unsafe painting provider ids before navigation or persistence', async () => {
    await expect(
      capability('paintings.defaultProvider.set').execute({ provider: '../settings/data' }, { source: 'agent' })
    ).rejects.toThrow('绘图服务商 ID 只能包含字母、数字、下划线或连字符。')
    await expect(
      capability('paintings.open').execute({ provider: 'openai?tab=settings' }, { source: 'agent' })
    ).rejects.toThrow('绘图服务商 ID 只能包含字母、数字、下划线或连字符。')
    await expect(
      capability('paintings.image.generate').execute(
        { prompt: 'draw a cat', provider: 'openai/../../settings' },
        { source: 'agent' }
      )
    ).rejects.toThrow('绘图服务商 ID 只能包含字母、数字、下划线或连字符。')

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })

  it('rejects invalid painting text input shapes before persistence or navigation', async () => {
    await expect(
      capability('paintings.defaultProvider.set').execute({ provider: 123 }, { source: 'agent' })
    ).rejects.toThrow('绘图服务商必须是字符串。')
    await expect(capability('paintings.open').execute({ provider: true }, { source: 'agent' })).rejects.toThrow(
      '绘图服务商必须是字符串。'
    )
    await expect(
      capability('paintings.image.generate').execute({ prompt: 123, provider: 'openai' }, { source: 'agent' })
    ).rejects.toThrow('绘图提示词必须是字符串。')
    await expect(
      capability('paintings.image.generate').execute(
        { prompt: 'draw a cat', provider: 'openai', model: ['gpt-image-1'] },
        { source: 'agent' }
      )
    ).rejects.toThrow('绘图模型必须是字符串。')
    await expect(
      capability('paintings.image.generate').execute(
        { prompt: 'draw a cat', provider: 'openai', size: { value: '1024x1024' } },
        { source: 'agent' }
      )
    ).rejects.toThrow('绘图尺寸必须是字符串。')

    expect(mocks.preferenceService.set).not.toHaveBeenCalled()
    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })

  it('normalizes painting provider routes before opening', async () => {
    const result = await capability('paintings.open').execute({ provider: ' openai ' }, { source: 'agent' })

    expect(mocks.navigateApp).toHaveBeenCalledWith('/paintings/openai')
    expect(result.data).toEqual({ route: '/paintings/openai' })
  })

  it('opens the preference-backed default provider when no provider is given', async () => {
    const result = await capability('paintings.open').execute({}, { source: 'agent' })

    expect(mocks.navigateApp).toHaveBeenCalledWith('/paintings/openai')
    expect(result.data).toEqual({ route: '/paintings/openai' })
  })

  it('normalizes image generation requests before opening the painting workspace', async () => {
    const prompt = `${'p'.repeat(600)} trailing`

    const result = await capability('paintings.image.generate').execute(
      {
        prompt: ` ${prompt} `,
        provider: ' openai ',
        model: ' gpt-image-1 ',
        size: ' 1024x1024 '
      },
      { source: 'agent' }
    )

    expect(mocks.navigateApp).toHaveBeenCalledWith('/paintings/openai')
    expect(result.data).toMatchObject({
      provider: 'openai',
      route: '/paintings/openai',
      model: 'gpt-image-1',
      size: '1024x1024'
    })
    expect((result.data as any).prompt).toHaveLength(503)
    expect((result.data as any).prompt).toContain('...')
  })

  it('rejects empty image generation prompts before opening the painting workspace', async () => {
    await expect(
      capability('paintings.image.generate').execute({ prompt: '   ', provider: 'openai' }, { source: 'agent' })
    ).rejects.toThrow('绘图提示词不能为空。')

    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })
})
