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

  it('rejects empty painting provider updates', async () => {
    await expect(
      capability('paintings.defaultProvider.set').execute({ provider: '   ' }, { source: 'agent' })
    ).rejects.toThrow('Painting provider is required')

    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
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
})
