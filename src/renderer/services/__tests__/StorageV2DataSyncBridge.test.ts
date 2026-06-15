import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  handleSaveData: vi.fn(),
  prepareStorageV2ForDataSync: vi.fn(),
  state: {
    dataSyncWebdavHost: 'https://dav.example.com',
    dataSyncWebdavUser: 'user',
    dataSyncWebdavPass: 'secret',
    dataSyncWebdavPath: '/sync-root',
    dataSyncAutoSync: true,
    dataSyncSyncInterval: 15
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    dispatch: mocks.dispatch,
    getState: () => ({
      settings: mocks.state
    })
  },
  handleSaveData: mocks.handleSaveData
}))

vi.mock('@renderer/store/settings', () => ({
  setDataSyncAutoSync: (payload: boolean) => ({ type: 'settings/setDataSyncAutoSync', payload }),
  setDataSyncSyncInterval: (payload: number) => ({ type: 'settings/setDataSyncSyncInterval', payload }),
  setDataSyncWebdavHost: (payload: string) => ({ type: 'settings/setDataSyncWebdavHost', payload }),
  setDataSyncWebdavPass: (payload: string) => ({ type: 'settings/setDataSyncWebdavPass', payload }),
  setDataSyncWebdavPath: (payload: string) => ({ type: 'settings/setDataSyncWebdavPath', payload }),
  setDataSyncWebdavUser: (payload: string) => ({ type: 'settings/setDataSyncWebdavUser', payload })
}))

vi.mock('../StorageV2Service', () => ({
  prepareStorageV2ForDataSync: mocks.prepareStorageV2ForDataSync
}))

import {
  type DataSyncBridgeSettings,
  RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE,
  RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
  RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE
} from '@shared/dataSyncBridge'

import { registerStorageV2DataSyncBridge } from '../StorageV2DataSyncBridge'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function resetState() {
  mocks.state.dataSyncWebdavHost = 'https://dav.example.com'
  mocks.state.dataSyncWebdavUser = 'user'
  mocks.state.dataSyncWebdavPass = 'secret'
  mocks.state.dataSyncWebdavPath = '/sync-root'
  mocks.state.dataSyncAutoSync = true
  mocks.state.dataSyncSyncInterval = 15
}

function installDispatchReducer() {
  mocks.dispatch.mockImplementation((action: { type: string; payload: unknown }) => {
    switch (action.type) {
      case 'settings/setDataSyncWebdavHost':
        mocks.state.dataSyncWebdavHost = action.payload as string
        break
      case 'settings/setDataSyncWebdavUser':
        mocks.state.dataSyncWebdavUser = action.payload as string
        break
      case 'settings/setDataSyncWebdavPass':
        mocks.state.dataSyncWebdavPass = action.payload as string
        break
      case 'settings/setDataSyncWebdavPath':
        mocks.state.dataSyncWebdavPath = action.payload as string
        break
      case 'settings/setDataSyncAutoSync':
        mocks.state.dataSyncAutoSync = action.payload as boolean
        break
      case 'settings/setDataSyncSyncInterval':
        mocks.state.dataSyncSyncInterval = action.payload as number
        break
    }
    return action
  })
}

function bridgeWindow() {
  return window as Window & {
    [RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE]?: () => DataSyncBridgeSettings
    [RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE]?: () => Promise<void>
    [RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE]?: (
      settings: Partial<DataSyncBridgeSettings>
    ) => Promise<DataSyncBridgeSettings>
  }
}

describe('StorageV2DataSyncBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
    installDispatchReducer()
    mocks.handleSaveData.mockResolvedValue(undefined)
    mocks.prepareStorageV2ForDataSync.mockResolvedValue(undefined)
    delete bridgeWindow()[RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE]
    delete bridgeWindow()[RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE]
    delete bridgeWindow()[RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE]
  })

  it('reads the current data sync settings from the renderer store', () => {
    registerStorageV2DataSyncBridge()

    expect(bridgeWindow()[RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE]?.()).toEqual({
      dataSyncWebdavHost: 'https://dav.example.com',
      dataSyncWebdavUser: 'user',
      dataSyncWebdavPass: 'secret',
      dataSyncWebdavPath: '/sync-root',
      dataSyncAutoSync: true,
      dataSyncSyncInterval: 15
    })
  })

  it('flushes Storage v2 after saving WebDAV settings through the bridge', async () => {
    registerStorageV2DataSyncBridge()
    const pendingFlush = deferred<void>()
    mocks.handleSaveData.mockReturnValueOnce(pendingFlush.promise)

    const call = bridgeWindow()[RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE]?.({
      dataSyncWebdavHost: 'https://next.example.com',
      dataSyncWebdavUser: 'next-user',
      dataSyncWebdavPass: 'next-secret',
      dataSyncWebdavPath: '/next-root',
      dataSyncAutoSync: false,
      dataSyncSyncInterval: 30
    })
    if (!call) throw new Error('Missing data sync settings bridge')

    expect(mocks.dispatch).toHaveBeenCalledTimes(6)
    expect(mocks.handleSaveData).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.handleSaveData.mock.invocationCallOrder[0]
    )

    let settled = false
    void call.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    pendingFlush.resolve()

    await expect(call).resolves.toEqual({
      dataSyncWebdavHost: 'https://next.example.com',
      dataSyncWebdavUser: 'next-user',
      dataSyncWebdavPass: 'next-secret',
      dataSyncWebdavPath: '/next-root',
      dataSyncAutoSync: false,
      dataSyncSyncInterval: 30
    })
  })

  it('prepares Storage v2 for data sync through the bridge', async () => {
    registerStorageV2DataSyncBridge()

    await bridgeWindow()[RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE]?.()

    expect(mocks.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
  })
})
