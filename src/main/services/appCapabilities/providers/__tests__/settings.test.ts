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
        port: 23333,
        apiKey: 'server-secret'
      },
      serviceAccount: {
        privateKey: '-----BEGIN PRIVATE KEY-----'
      },
      webdavPass: 'dav-secret'
    })
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
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

  it('redacts sensitive setting update values in the agent response only', async () => {
    const result = await capability('settings.value.set').execute(
      { path: 'apiServer.apiKey', value: 'new-server-secret' },
      { source: 'agent' }
    )

    expect(mocks.reduxService.dispatch).toHaveBeenCalledWith({
      type: 'settings/setApiServerApiKey',
      payload: 'new-server-secret'
    })
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

    expect(mocks.reduxService.dispatch).toHaveBeenCalledWith({
      type: 'settings/setApiServerPort',
      payload: 23334
    })
    expect(result.data).toEqual({
      path: 'apiServer.port',
      value: 23334
    })
  })

  it('rejects empty setting paths without reading all settings', async () => {
    await expect(capability('settings.value.get').execute({ path: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Setting path is required'
    )

    expect(mocks.reduxService.select).not.toHaveBeenCalled()
  })

  it('rejects empty setting update paths without dispatching', async () => {
    await expect(
      capability('settings.value.set').execute({ path: '   ', value: 'dark' }, { source: 'agent' })
    ).rejects.toThrow('Setting path is required')

    expect(mocks.reduxService.dispatch).not.toHaveBeenCalled()
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
