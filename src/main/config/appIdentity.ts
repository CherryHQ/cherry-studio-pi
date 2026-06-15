export const APP_ID = 'com.cherryai.cherrystudio-pi'
export const APP_PRODUCT_NAME = 'Cherry Studio Pi'
export const APP_COMPACT_NAME = 'CherryStudioPi'
export const APP_LINUX_WM_CLASS = APP_COMPACT_NAME
export const APP_TEMP_DIRNAME = APP_COMPACT_NAME

export const LEGACY_APP_ID = 'com.cherryai.cherrystudio'
export const ELECTRON_DEV_APP_ID = 'com.github.Electron'

export const APP_PROCESS_IDENTIFIERS = [ELECTRON_DEV_APP_ID, APP_ID, LEGACY_APP_ID] as const

export function isAppProcessIdentifier(programName: string): boolean {
  return (APP_PROCESS_IDENTIFIERS as readonly string[]).includes(programName)
}
