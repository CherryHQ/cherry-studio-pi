export const MCP_PROVIDER_SYNC_TIMEOUT_MS = 15_000

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

export class McpProviderRequestTimeoutError extends Error {
  timeoutMs: number

  constructor(timeoutMs = MCP_PROVIDER_SYNC_TIMEOUT_MS) {
    const seconds = Math.round(timeoutMs / 1000)
    super(`MCP provider request timed out after ${seconds}s`)
    this.name = 'McpProviderRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export function isMcpProviderRequestTimeoutError(error: unknown): error is McpProviderRequestTimeoutError {
  return error instanceof McpProviderRequestTimeoutError
}

export async function fetchWithProviderTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = MCP_PROVIDER_SYNC_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const externalSignal = init.signal
  const timeoutError = new McpProviderRequestTimeoutError(timeoutMs)
  const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  timeoutId.unref?.()

  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) {
    abortFromExternalSignal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeoutError) {
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

export function getProviderSyncErrorMessage(t: TranslateFn, error: unknown): string {
  if (isMcpProviderRequestTimeoutError(error)) {
    return t('settings.mcp.sync.timeout', {
      seconds: Math.round(error.timeoutMs / 1000),
      defaultValue: 'Sync timed out. Please check your network connection and try again.'
    })
  }

  return t('settings.mcp.sync.error')
}

export function getProviderSyncErrorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
