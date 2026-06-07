import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'
import { BrowserWindow } from 'electron'

const DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS = 5_000
const DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS = 5_000

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

  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) continue

    let hasBridge = false
    try {
      hasBridge = await withRendererBridgeTimeout(
        browserWindow.webContents.executeJavaScript(`typeof window[${bridgeName}] === 'function'`) as Promise<boolean>,
        options.checkTimeoutMs ?? DEFAULT_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
        '等待主窗口响应超时'
      )
    } catch (error) {
      lastProbeError = error
      continue
    }

    if (!hasBridge) continue

    try {
      return await withRendererBridgeTimeout(
        browserWindow.webContents.executeJavaScript(callScript),
        options.timeoutMs ?? DEFAULT_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
        options.timeoutMessage ?? '调用主窗口桥接能力超时'
      )
    } catch (error) {
      throw new Error(getBridgeErrorMessage(error))
    }
  }

  if (lastProbeError) {
    throw new Error(getBridgeErrorMessage(lastProbeError))
  }
  throw new Error('主窗口尚未就绪，请打开主窗口后重试。')
}

export async function readRendererStoreValue<T>(path: string): Promise<T> {
  return callRendererBridge<T>(
    RENDERER_GET_STORE_VALUE_BRIDGE,
    { path },
    {
      timeoutMessage: `读取运行时状态超时：${path}`
    }
  )
}
