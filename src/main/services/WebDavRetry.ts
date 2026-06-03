import {
  formatWebDavAlreadyRunningMessage,
  formatWebDavConflictMessage,
  formatWebDavFailurePrefix,
  formatWebDavHostRequiredMessage,
  formatWebDavInsufficientStorageMessage,
  formatWebDavInvalidUrlMessage,
  formatWebDavLockedMessage,
  formatWebDavNetworkMessage,
  formatWebDavNotFoundMessage,
  formatWebDavRateLimitedMessage,
  formatWebDavReadForbiddenMessage,
  formatWebDavTargetText,
  formatWebDavUnauthorizedMessage,
  formatWebDavUnavailableMessage,
  formatWebDavUnhandledStatusMessage,
  formatWebDavUnknownMessage,
  formatWebDavWriteForbiddenMessage,
  WEB_DAV_DEFAULT_ACTION,
  WEB_DAV_NETWORK_ERROR_PATTERNS
} from '@main/i18n/webDavMessages'

type WebDavRetryLogger = {
  warn: (message: string, ...data: any[]) => void
}

type WebDavRetryOptions = {
  logger?: WebDavRetryLogger
  maxAttempts?: number
  initialDelayMs?: number
  timeoutMs?: number
}

const RETRIABLE_WEB_DAV_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_WEB_DAV_OPERATION_TIMEOUT_MS = 90_000

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

function getOriginalError(error: unknown) {
  return error instanceof WebDavOperationError ? error.originalError : error
}

function getOperationTarget(error: unknown) {
  if (!(error instanceof WebDavOperationError)) {
    return null
  }

  const match = error.operation.match(/\s(\/[^ ]*)$/)
  return match?.[1] ?? null
}

function getOperation(error: unknown) {
  return error instanceof WebDavOperationError ? error.operation : ''
}

function isWriteOperation(operation: string) {
  return /\b(creating|writing|uploading|deleting|restoring)\b/i.test(operation)
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

function isTimeoutError(error: unknown) {
  return /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timed out|timeout/i.test(errorMessage(error))
}

function withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`WebDAV operation timed out after ${timeoutMs}ms while ${operation}`) as Error & {
        code: string
      }
      error.code = 'ETIMEDOUT'
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
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
    this.transient = (status !== null && RETRIABLE_WEB_DAV_STATUSES.has(status)) || isTimeoutError(originalError)
  }
}

export function normalizeWebDavHost(webdavHost?: string) {
  const trimmed = webdavHost?.trim() ?? ''
  if (!trimmed) return ''
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function describeWebDavUserFacingError(error: unknown, action = WEB_DAV_DEFAULT_ACTION) {
  const source = getOriginalError(error)
  const status = getWebDavErrorStatus(source)
  const message = errorMessage(source)
  const prefix = formatWebDavFailurePrefix(action)
  const operation = getOperation(error)
  const target = getOperationTarget(error)
  const targetText = target ? formatWebDavTargetText(target) : ''

  if (status) {
    if (status === 401) {
      return formatWebDavUnauthorizedMessage(prefix)
    }

    if (status === 403) {
      if (isWriteOperation(operation)) {
        return formatWebDavWriteForbiddenMessage(prefix, targetText)
      }

      return formatWebDavReadForbiddenMessage(prefix, targetText)
    }

    if (status === 404) {
      return formatWebDavNotFoundMessage(prefix)
    }

    if (status === 409) {
      return formatWebDavConflictMessage(prefix)
    }

    if (status === 423) {
      return formatWebDavLockedMessage(prefix)
    }

    if (status === 429) {
      return formatWebDavRateLimitedMessage(prefix)
    }

    if (status === 507) {
      return formatWebDavInsufficientStorageMessage(prefix)
    }

    if ([408, 500, 502, 503, 504].includes(status)) {
      return formatWebDavUnavailableMessage(prefix)
    }

    return formatWebDavUnhandledStatusMessage(prefix, status)
  }

  const networkMatch = WEB_DAV_NETWORK_ERROR_PATTERNS.find((item) => item.pattern.test(message))
  if (networkMatch) {
    return formatWebDavNetworkMessage(prefix, networkMatch.message)
  }

  if (/WebDAV host is required/i.test(message)) {
    return formatWebDavHostRequiredMessage(prefix)
  }

  if (/Data sync is already running|已有数据同步正在进行|同步正在进行/i.test(message)) {
    return formatWebDavAlreadyRunningMessage(prefix)
  }

  if (/当前 WebDAV 客户端不支持删除远端文件/i.test(message)) {
    return `${prefix}：${message}`
  }

  if (/deleting .*sync probe/i.test(operation)) {
    return formatWebDavWriteForbiddenMessage(prefix, targetText)
  }

  if (/另一台设备正在同步这个 WebDAV 目录|远端同步锁|无法创建远端同步锁/i.test(message)) {
    return `${prefix}：${message}`
  }

  if (/远端同步状态在同步过程中|Remote sync metadata is corrupted/i.test(message)) {
    return `${prefix}：远端同步状态异常。${message}`
  }

  if (/远端 Storage v2 数据包校验失败|Storage v2 .*bundle hash mismatch/i.test(message)) {
    return `${prefix}：${message}`
  }

  if (/Invalid URL|Only absolute URLs|URL/i.test(message)) {
    return formatWebDavInvalidUrlMessage(prefix)
  }

  return formatWebDavUnknownMessage(prefix)
}

export async function runWebDavOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  options: WebDavRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 500)
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_WEB_DAV_OPERATION_TIMEOUT_MS)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(fn(), operation, timeoutMs)
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
