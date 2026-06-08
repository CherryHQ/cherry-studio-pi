import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'
import { BrowserWindow } from 'electron'

const DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS = 5_000
const DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS = 5_000

type RendererBridgeProbeResult = {
  hasBridge: boolean
  error?: unknown
}

export function getBridgeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function withRendererBridgeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        timeout.unref?.()
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function callRendererBridge<T>(
  bridgeKey: string,
  payload?: unknown,
  options: {
    checkTimeoutMs?: number
    timeoutMs?: number
    timeoutMessage?: string
  } = {}
): Promise<T> {
  const bridgeName = JSON.stringify(bridgeKey)
  const callScript =
    typeof payload === 'undefined' ? `window[${bridgeName}]()` : `window[${bridgeName}](${JSON.stringify(payload)})`
  let lastProbeError: unknown
  const browserWindows = BrowserWindow.getAllWindows().filter(
    (browserWindow) => !browserWindow.isDestroyed() && !browserWindow.webContents.isDestroyed?.()
  )

  const probes = browserWindows.map((browserWindow) => ({
    browserWindow,
    promise: withRendererBridgeTimeout(
      browserWindow.webContents.executeJavaScript(`typeof window[${bridgeName}] === 'function'`) as Promise<boolean>,
      options.checkTimeoutMs ?? DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
      'Timed out waiting for the main window to respond'
    )
      .then<RendererBridgeProbeResult>((hasBridge) => ({ hasBridge }))
      .catch<RendererBridgeProbeResult>((error) => ({ hasBridge: false, error }))
  }))

  const pendingProbes = new Set(probes)
  let lastCallError: unknown
  while (pendingProbes.size > 0) {
    const { probe, result } = await Promise.race(
      Array.from(pendingProbes, (probe) => probe.promise.then((result) => ({ probe, result })))
    )
    pendingProbes.delete(probe)

    if (result.error) {
      lastProbeError = result.error
    }
    if (!result.hasBridge) continue

    try {
      return await withRendererBridgeTimeout(
        probe.browserWindow.webContents.executeJavaScript(callScript),
        options.timeoutMs ?? DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
        options.timeoutMessage ?? 'Timed out calling the main window bridge'
      )
    } catch (error) {
      lastCallError = error
    }
  }

  if (lastCallError) {
    throw new Error(getBridgeErrorMessage(lastCallError))
  }
  if (lastProbeError) {
    throw new Error(getBridgeErrorMessage(lastProbeError))
  }
  throw new Error('The main window is not ready. Open the main window and try again.')
}

export async function readRendererStoreValue<T>(path: string): Promise<T> {
  return callRendererBridge<T>(
    RENDERER_GET_STORE_VALUE_BRIDGE,
    { path },
    {
      timeoutMessage: `Timed out reading runtime state: ${path}`
    }
  )
}
