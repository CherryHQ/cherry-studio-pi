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
  formatWebDavPreconditionMessage,
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
import { normalizeWebDavHost as normalizeSharedWebDavHost } from '@shared/webdavConfig'

type WebDavRetryLogger = {
  warn: (message: string, ...data: any[]) => void
}

type WebDavRetryOptions = {
  logger?: WebDavRetryLogger
  maxAttempts?: number
  initialDelayMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

const RETRIABLE_WEB_DAV_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_WEB_DAV_OPERATION_TIMEOUT_MS = 45_000
const UNKNOWN_WEB_DAV_ERROR_MESSAGE = 'Unknown WebDAV error'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value)
  return null
}

function normalizeMessageText(message: unknown) {
  if (typeof message !== 'string') return null

  const normalizedMessage = message.trim()
  return normalizedMessage.length > 0 ? normalizedMessage : null
}

function extractErrorMessage(error: unknown, seen = new WeakSet<object>()): string | null {
  if (error instanceof Error) {
    return normalizeMessageText(error.message) ?? extractErrorMessage(error.cause, seen)
  }

  if (typeof error === 'string') return normalizeMessageText(error)
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)

  const source = asObject(error)
  if (!source) return null

  if (seen.has(source)) return null
  seen.add(source)

  for (const key of ['message', 'error', 'cause', 'reason', 'description', 'response'] as const) {
    const message = extractErrorMessage(source[key], seen)
    if (message) return message
  }

  const status = parseStatus(source.status) ?? parseStatus(source.statusCode) ?? parseStatus(source.code)
  const statusText = normalizeMessageText(source.statusText)
  if (status && statusText) return `${status} ${statusText}`
  if (status) return `${status}`

  const code = normalizeMessageText(source.code)
  return code
}

function errorMessage(error: unknown) {
  return extractErrorMessage(error) ?? UNKNOWN_WEB_DAV_ERROR_MESSAGE
}

function normalizeMaxAttempts(value: number | undefined) {
  const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? value : 3
  return Math.max(1, Math.floor(normalizedValue))
}

function normalizeNonNegativeDelay(value: number | undefined, defaultValue: number) {
  const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
  return Math.max(0, normalizedValue)
}

export function getWebDavErrorStatus(error: unknown): number | null {
  const source = asObject(error)
  const directStatus =
    parseStatus(source?.status) ?? parseStatus(source?.statusCode) ?? parseStatus(source?.code) ?? null
  if (directStatus) return directStatus

  const response = asObject(source?.response)
  const responseStatus = parseStatus(response?.status) ?? parseStatus(response?.statusCode)
  if (responseStatus) return responseStatus

  const message = errorMessage(error)
  const match = message.match(/\b(?:Invalid response:|status(?: code)?[:=]?)\s*(\d{3})\b/i)
  if (match) return Number(match[1])

  const bareHttpStatus = message.match(/\b(4\d{2}|5\d{2})\s+[A-Za-z][^\n]*/i)
  return bareHttpStatus ? Number(bareHttpStatus[1]) : null
}

function getWebDavErrorStatusText(error: unknown) {
  const source = asObject(error)
  const directStatusText = normalizeMessageText(source?.statusText)
  if (directStatusText) return directStatusText

  const responseStatusText = normalizeMessageText(asObject(source?.response)?.statusText)
  if (responseStatusText) return responseStatusText

  const message = errorMessage(error)
  const match = message.match(/\b(?:Invalid response:|status(?: code)?[:=]?)\s*\d{3}\s+([^\n]+)$/i)
  if (match?.[1]?.trim()) return match[1].trim()

  const bareHttpStatus = message.match(/\b(?:4\d{2}|5\d{2})\s+([A-Za-z][^\n]*)/i)
  return bareHttpStatus?.[1]?.trim() || null
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

function isActionableDataSyncMessage(message: string) {
  return (
    message.startsWith('安全快照上传失败') ||
    message.startsWith('远端旧同步文件清理失败') ||
    /^远端同步记录(缺失|校验失败)/.test(message) ||
    message.startsWith('远端同步状态') ||
    message.startsWith('远端安全快照') ||
    /^远端 Storage v2 (数据包|记录|manifest)/.test(message) ||
    message.startsWith('远端附件文件') ||
    message.startsWith('本地附件文件') ||
    message.startsWith('远端敏感配置') ||
    message.startsWith('远端数据已同步到本机') ||
    /^Storage v2 (记录引用了|数据中存在)/.test(message)
  )
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

function webDavAbortError(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string' && reason.trim()) return new Error(reason.trim())
  return new Error('WebDAV operation aborted')
}

function throwIfWebDavAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw webDavAbortError(signal)
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(webDavAbortError(signal))
      return
    }

    let abortListener: (() => void) | undefined
    const timeout = setTimeout(() => {
      if (abortListener) signal?.removeEventListener('abort', abortListener)
      resolve(undefined)
    }, ms)
    if (typeof timeout === 'object' && timeout && 'unref' in timeout && typeof timeout.unref === 'function') {
      timeout.unref()
    }
    if (signal) {
      abortListener = () => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abortListener!)
        reject(webDavAbortError(signal))
      }
      signal.addEventListener('abort', abortListener, { once: true })
    }
  })
}

function isTimeoutError(error: unknown) {
  return /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timed out|timeout/i.test(errorMessage(error))
}

function withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  throwIfWebDavAborted(signal)

  const shouldUseTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
  if (!shouldUseTimeout && !signal) {
    return promise
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let abortListener: (() => void) | undefined
  const timeout = shouldUseTimeout
    ? new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`WebDAV operation timed out after ${timeoutMs}ms while ${operation}`) as Error & {
            code: string
          }
          error.code = 'ETIMEDOUT'
          reject(error)
        }, timeoutMs)
        if (
          typeof timeoutId === 'object' &&
          timeoutId &&
          'unref' in timeoutId &&
          typeof timeoutId.unref === 'function'
        ) {
          timeoutId.unref()
        }
      })
    : null
  const abort = signal
    ? new Promise<never>((_, reject) => {
        abortListener = () => reject(webDavAbortError(signal))
        signal.addEventListener('abort', abortListener, { once: true })
      })
    : null

  return Promise.race([promise, ...(timeout ? [timeout] : []), ...(abort ? [abort] : [])]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    if (abortListener) signal?.removeEventListener('abort', abortListener)
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
  return normalizeSharedWebDavHost(webdavHost)
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

    if (status === 412) {
      return formatWebDavPreconditionMessage(prefix, targetText)
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

  if (/Storage v2 .*bundle hash mismatch/i.test(message)) {
    return `${prefix}：${message}`
  }

  if (isActionableDataSyncMessage(message)) {
    return `${prefix}：${message}`
  }

  if (/WebDAV (URL|用户名|密码)|账号或密码文本/.test(message)) {
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
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts)
  const initialDelayMs = normalizeNonNegativeDelay(options.initialDelayMs, 500)
  const timeoutMs = normalizeNonNegativeDelay(options.timeoutMs, DEFAULT_WEB_DAV_OPERATION_TIMEOUT_MS)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfWebDavAborted(options.signal)
    try {
      return await withTimeout(fn(), operation, timeoutMs, options.signal)
    } catch (error) {
      throwIfWebDavAborted(options.signal)
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
        await delay(retryDelay, options.signal)
      }
    }
  }

  throw new WebDavOperationError(operation, new Error('Unknown WebDAV retry failure'))
}
