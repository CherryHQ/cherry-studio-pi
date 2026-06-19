import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'
import { BrowserWindow } from 'electron'

const DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS = 5_000
const DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS = 5_000
const CACHED_RENDERER_BRIDGE_GRACE_MS = 50

type RendererBridgeProbeResult = {
  hasBridge: boolean
  error?: unknown
}

const cachedBridgeWindows = new Map<string, BrowserWindow>()

export function getBridgeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function rendererBridgeAbortError(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string' && reason.trim()) return new Error(reason.trim())
  return new Error('Renderer bridge call aborted')
}

export async function withRendererBridgeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
  options: {
    signal?: AbortSignal
  } = {}
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  try {
    const abort = options.signal
      ? new Promise<never>((_, reject) => {
          const onAbort = () => reject(rendererBridgeAbortError(options.signal!))
          if (options.signal!.aborted) {
            onAbort()
            return
          }
          abortListener = onAbort
          options.signal!.addEventListener('abort', onAbort, { once: true })
        })
      : null
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        timeout.unref?.()
      }),
      ...(abort ? [abort] : [])
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abortListener) options.signal?.removeEventListener('abort', abortListener)
  }
}

async function waitForCachedBridgeGrace(): Promise<null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), CACHED_RENDERER_BRIDGE_GRACE_MS)
    timeout.unref?.()
  })
}

async function probeRendererBridgeWindow(
  browserWindow: BrowserWindow,
  bridgeName: string,
  options: {
    checkTimeoutMs?: number
    signal?: AbortSignal
  }
): Promise<RendererBridgeProbeResult> {
  try {
    const hasBridge = await withRendererBridgeTimeout(
      browserWindow.webContents.executeJavaScript(`typeof window[${bridgeName}] === 'function'`) as Promise<boolean>,
      options.checkTimeoutMs ?? DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
      'Timed out waiting for the main window to respond',
      { signal: options.signal }
    )
    return { hasBridge }
  } catch (error) {
    return { hasBridge: false, error }
  }
}

function isUsableRendererWindow(browserWindow: BrowserWindow): boolean {
  return !browserWindow.isDestroyed() && !browserWindow.webContents.isDestroyed?.()
}

export async function callRendererBridge<T>(
  bridgeKey: string,
  payload?: unknown,
  options: {
    checkTimeoutMs?: number
    timeoutMs?: number
    timeoutMessage?: string
    signal?: AbortSignal
  } = {}
): Promise<T> {
  if (options.signal?.aborted) throw rendererBridgeAbortError(options.signal)

  const bridgeName = JSON.stringify(bridgeKey)
  const callScript =
    typeof payload === 'undefined' ? `window[${bridgeName}]()` : `window[${bridgeName}](${JSON.stringify(payload)})`
  let lastProbeError: unknown
  const browserWindows = BrowserWindow.getAllWindows().filter(isUsableRendererWindow)
  const cachedWindow = cachedBridgeWindows.get(bridgeKey)
  let cachedProbe: Promise<{
    browserWindow: BrowserWindow
    result: RendererBridgeProbeResult
  }> | null = null

  if (cachedWindow && !browserWindows.includes(cachedWindow)) {
    cachedBridgeWindows.delete(bridgeKey)
  }

  if (cachedWindow && browserWindows.includes(cachedWindow)) {
    cachedProbe = probeRendererBridgeWindow(cachedWindow, bridgeName, options).then((result) => ({
      browserWindow: cachedWindow,
      result
    }))
    const cachedFastResult = await Promise.race([cachedProbe, waitForCachedBridgeGrace()])
    if (cachedFastResult) {
      cachedProbe = null
      if (cachedFastResult.result.hasBridge) {
        try {
          const value = await withRendererBridgeTimeout(
            cachedFastResult.browserWindow.webContents.executeJavaScript(callScript),
            options.timeoutMs ?? DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
            options.timeoutMessage ?? 'Timed out calling the main window bridge',
            { signal: options.signal }
          )
          cachedBridgeWindows.set(bridgeKey, cachedFastResult.browserWindow)
          return value as T
        } catch (error) {
          cachedBridgeWindows.delete(bridgeKey)
          lastProbeError = error
        }
      } else {
        cachedBridgeWindows.delete(bridgeKey)
        lastProbeError = cachedFastResult.result.error
      }
    }
  }

  const probeWindows = cachedWindow
    ? browserWindows.filter((browserWindow) => browserWindow !== cachedWindow)
    : browserWindows

  const probes = probeWindows.map((browserWindow) => ({
    type: 'probe' as const,
    browserWindow,
    promise: withRendererBridgeTimeout(
      browserWindow.webContents.executeJavaScript(`typeof window[${bridgeName}] === 'function'`) as Promise<boolean>,
      options.checkTimeoutMs ?? DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
      'Timed out waiting for the main window to respond',
      { signal: options.signal }
    )
      .then<RendererBridgeProbeResult>((hasBridge) => ({ hasBridge }))
      .catch<RendererBridgeProbeResult>((error) => ({ hasBridge: false, error }))
  }))

  const pendingProbes = new Set<
    | (typeof probes)[number]
    | {
        type: 'cached'
        browserWindow: BrowserWindow
        promise: Promise<RendererBridgeProbeResult>
      }
  >(probes)
  if (cachedProbe) {
    pendingProbes.add({
      type: 'cached',
      browserWindow: cachedWindow as BrowserWindow,
      promise: cachedProbe.then(({ result }) => result)
    })
  }
  let lastCallError: unknown
  while (pendingProbes.size > 0) {
    const { probe, result } = await Promise.race(
      Array.from(pendingProbes, (probe) => probe.promise.then((result) => ({ probe, result })))
    )
    pendingProbes.delete(probe)
    if (options.signal?.aborted) throw rendererBridgeAbortError(options.signal)

    if (result.error) {
      lastProbeError = result.error
    }
    if (!result.hasBridge) continue

    try {
      const value = await withRendererBridgeTimeout(
        probe.browserWindow.webContents.executeJavaScript(callScript),
        options.timeoutMs ?? DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
        options.timeoutMessage ?? 'Timed out calling the main window bridge',
        { signal: options.signal }
      )
      cachedBridgeWindows.set(bridgeKey, probe.browserWindow)
      return value as T
    } catch (error) {
      if (cachedBridgeWindows.get(bridgeKey) === probe.browserWindow) {
        cachedBridgeWindows.delete(bridgeKey)
      }
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

export async function readRendererStoreValue<T>(
  path: string,
  options: {
    checkTimeoutMs?: number
    timeoutMs?: number
    timeoutMessage?: string
    signal?: AbortSignal
  } = {}
): Promise<T> {
  return callRendererBridge<T>(
    RENDERER_GET_STORE_VALUE_BRIDGE,
    { path },
    {
      checkTimeoutMs: options.checkTimeoutMs,
      timeoutMs: options.timeoutMs,
      timeoutMessage: options.timeoutMessage ?? `Timed out reading runtime state: ${path}`,
      signal: options.signal
    }
  )
}
