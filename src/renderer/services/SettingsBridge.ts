import store from '@renderer/store'
import {
  RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE,
  RENDERER_GET_SETTINGS_BRIDGE,
  type SettingsBridgeAction
} from '@shared/settingsBridge'

type SettingsBridgeWindow = Window & {
  [RENDERER_GET_SETTINGS_BRIDGE]?: () => unknown
  [RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE]?: (action: SettingsBridgeAction) => unknown
}

function readSettingsSnapshot() {
  return store.getState().settings
}

export function registerSettingsBridge() {
  const bridgeWindow = window as SettingsBridgeWindow
  bridgeWindow[RENDERER_GET_SETTINGS_BRIDGE] = () => readSettingsSnapshot()
  bridgeWindow[RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE] = (action) => {
    if (!action || typeof action.type !== 'string' || !action.type.startsWith('settings/')) {
      throw new Error('Invalid settings action')
    }
    store.dispatch(action as never)
    return readSettingsSnapshot()
  }
}
