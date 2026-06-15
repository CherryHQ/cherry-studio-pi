import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(),
  handleSaveData: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    dispatch: mocks.dispatch,
    getState: mocks.getState
  },
  handleSaveData: mocks.handleSaveData
}))

import {
  RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE,
  RENDERER_GET_SETTINGS_BRIDGE,
  type SettingsBridgeAction
} from '@shared/settingsBridge'

import { registerSettingsBridge } from '../SettingsBridge'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

type SettingsBridgeTestWindow = Window & {
  [RENDERER_GET_SETTINGS_BRIDGE]?: () => unknown
  [RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]?: (action: SettingsBridgeAction) => Promise<unknown>
}

function bridgeWindow() {
  return window as SettingsBridgeTestWindow
}

describe('SettingsBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete bridgeWindow()[RENDERER_GET_SETTINGS_BRIDGE]
    delete bridgeWindow()[RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]
    mocks.getState.mockReturnValue({
      settings: {
        theme: 'light',
        fontSize: 14
      }
    })
    mocks.handleSaveData.mockResolvedValue(undefined)
  })

  it('reads the current settings snapshot', () => {
    registerSettingsBridge()

    expect(bridgeWindow()[RENDERER_GET_SETTINGS_BRIDGE]?.()).toEqual({
      theme: 'light',
      fontSize: 14
    })
  })

  it('waits for settings persistence before resolving dispatched settings actions', async () => {
    const save = deferred<void>()
    mocks.handleSaveData.mockReturnValueOnce(save.promise)
    registerSettingsBridge()

    const call = bridgeWindow()[RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]?.({
      type: 'settings/setTheme',
      payload: 'dark'
    })

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'settings/setTheme',
      payload: 'dark'
    })
    expect(mocks.handleSaveData).toHaveBeenCalledTimes(1)

    let resolved = false
    void call?.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    mocks.getState.mockReturnValue({
      settings: {
        theme: 'dark',
        fontSize: 14
      }
    })
    save.resolve()

    await expect(call).resolves.toEqual({
      theme: 'dark',
      fontSize: 14
    })
    expect(resolved).toBe(true)
  })

  it('rejects non-settings actions without dispatching', async () => {
    registerSettingsBridge()

    await expect(
      bridgeWindow()[RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]?.({
        type: 'assistants/setDefaultModel',
        payload: 'model-1'
      })
    ).rejects.toThrow('Invalid settings action')

    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.handleSaveData).not.toHaveBeenCalled()
  })
})
