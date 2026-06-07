import store from '@renderer/store'
import { RENDERER_GET_STORE_VALUE_BRIDGE, type StoreValueBridgeRequest } from '@shared/storeBridge'

type StoreBridgeWindow = Window & {
  [RENDERER_GET_STORE_VALUE_BRIDGE]?: (request: StoreValueBridgeRequest) => unknown
}

function pickPath(value: unknown, keyPath: string) {
  const normalizedPath = keyPath.startsWith('state.') ? keyPath.slice('state.'.length) : keyPath
  if (!normalizedPath) return value
  return normalizedPath.split('.').reduce((current: any, key) => current?.[key], value)
}

export function registerStoreBridge() {
  const bridgeWindow = window as StoreBridgeWindow
  bridgeWindow[RENDERER_GET_STORE_VALUE_BRIDGE] = (request) => {
    if (!request || typeof request.path !== 'string') throw new Error('Store path is required')
    return pickPath(store.getState(), request.path.trim())
  }
}
