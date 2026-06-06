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
  pickPath: (value: any, keyPath = '') =>
    keyPath ? keyPath.split('.').reduce((current, key) => current?.[key], value) : value,
  sanitizeForAgent: (value: unknown) => value
}))

import { createSettingsCapabilities } from '../settings'

function capability(id: string) {
  const item = createSettingsCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('settings app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reduxService.select.mockResolvedValue({
      theme: 'dark',
      apiServer: {
        port: 23333
      }
    })
  })

  it('reads a single setting value by path', async () => {
    const result = await capability('settings.value.get').execute({ path: 'apiServer.port' }, { source: 'agent' })

    expect(result).toEqual({
      ok: true,
      summary: 'Setting value read',
      data: {
        path: 'apiServer.port',
        value: 23333
      }
    })
    expect(mocks.reduxService.select).toHaveBeenCalledWith('state.settings')
  })

  it('rejects empty setting paths without reading all settings', async () => {
    await expect(capability('settings.value.get').execute({ path: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Setting path is required'
    )

    expect(mocks.reduxService.select).not.toHaveBeenCalled()
  })
})
