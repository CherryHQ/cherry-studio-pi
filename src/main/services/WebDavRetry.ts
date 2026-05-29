type WebDavRetryLogger = {
  warn: (message: string, ...data: any[]) => void
}

type WebDavRetryOptions = {
  logger?: WebDavRetryLogger
  maxAttempts?: number
  initialDelayMs?: number
}

const RETRIABLE_WEB_DAV_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value)
  return null
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function getWebDavErrorStatus(error: unknown): number | null {
  const source = asObject(error)
  const directStatus =
    parseStatus(source?.status) ?? parseStatus(source?.statusCode) ?? parseStatus(source?.code) ?? null
  if (directStatus) return directStatus

  const response = asObject(source?.response)
  const responseStatus = parseStatus(response?.status) ?? parseStatus(response?.statusCode)
  if (responseStatus) return responseStatus

  const match = errorMessage(error).match(/\b(?:Invalid response:|status(?: code)?[:=]?)\s*(\d{3})\b/i)
  return match ? Number(match[1]) : null
}

function getWebDavErrorStatusText(error: unknown) {
  const message = errorMessage(error)
  const match = message.match(/\b(?:Invalid response:|status(?: code)?[:=]?)\s*\d{3}\s+([^\n]+)$/i)
  return match?.[1]?.trim() || null
}

function describeWebDavError(error: unknown) {
  const status = getWebDavErrorStatus(error)
  const statusText = getWebDavErrorStatusText(error)
  if (status) {
    return statusText ? `${status} ${statusText}` : `${status}`
  }

  return errorMessage(error)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(errorMessage(error))
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class WebDavOperationError extends Error {
  readonly status: number | null
  readonly transient: boolean

  constructor(
    readonly operation: string,
    readonly originalError: unknown
  ) {
    const status = getWebDavErrorStatus(originalError)
    super(`WebDAV request failed while ${operation}: ${describeWebDavError(originalError)}`)
    this.name = 'WebDavOperationError'
    this.status = status
    this.transient = status !== null && RETRIABLE_WEB_DAV_STATUSES.has(status)
  }
}

export async function runWebDavOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  options: WebDavRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 500)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const wrapped = new WebDavOperationError(operation, error)
      if (!wrapped.transient || attempt >= maxAttempts) {
        throw wrapped
      }

      options.logger?.warn(
        `Transient WebDAV error while ${operation}; retrying ${attempt}/${maxAttempts}`,
        toError(error)
      )

      const retryDelay = initialDelayMs * 2 ** (attempt - 1)
      if (retryDelay > 0) {
        await delay(retryDelay)
      }
    }
  }

  throw new WebDavOperationError(operation, new Error('Unknown WebDAV retry failure'))
}
