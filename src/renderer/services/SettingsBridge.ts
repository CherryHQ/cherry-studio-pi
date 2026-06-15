import store, { handleSaveData } from '@renderer/store'
import {
  RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE,
  RENDERER_GET_SETTINGS_BRIDGE,
  type SettingsBridgeAction
} from '@shared/settingsBridge'

type SettingsBridgeWindow = Window & {
  [RENDERER_GET_SETTINGS_BRIDGE]?: () => unknown
  [RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]?: (action: SettingsBridgeAction) => Promise<unknown>
}

function readSettingsSnapshot() {
  return store.getState().settings
}

export function registerSettingsBridge() {
  const bridgeWindow = window as SettingsBridgeWindow
  bridgeWindow[RENDERER_GET_SETTINGS_BRIDGE] = () => readSettingsSnapshot()
  bridgeWindow[RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE] = async (action) => {
    if (!action || typeof action.type !== 'string' || !action.type.startsWith('settings/')) {
      throw new Error('Invalid settings action')
    }
    store.dispatch(action as never)
    await handleSaveData()
    return readSettingsSnapshot()
  }
}
