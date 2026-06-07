export const RENDERER_GET_SETTINGS_BRIDGE = '__CHERRY_STUDIO_PI_GET_SETTINGS__'
export const RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE = '__CHERRY_STUDIO_PI_DISPATCH_SETTINGS_ACTION__'

export type SettingsBridgeAction = {
  type: string
  payload?: unknown
}
