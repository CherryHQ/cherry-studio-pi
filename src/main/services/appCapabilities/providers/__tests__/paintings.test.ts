import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reduxService: {
    select: vi.fn(),
    dispatch: vi.fn()
  },
  navigateApp: vi.fn()
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
  sanitizeForAgent: (value: unknown) => value
}))

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
    mocks.reduxService.select.mockImplementation(async (path: string) => {
      if (path === 'state.paintings') return paintingState
      if (path === 'state.settings') return { defaultPaintingProvider: 'silicon' }
      return null
    })
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
  })
})
