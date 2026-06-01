type WebDavRetryLogger = {
  warn: (message: string, ...data: any[]) => void
}

type WebDavRetryOptions = {
  logger?: WebDavRetryLogger
  maxAttempts?: number
  initialDelayMs?: number
}

const RETRIABLE_WEB_DAV_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const NETWORK_ERROR_PATTERNS = [
  { pattern: /\bENOTFOUND\b|\bEAI_AGAIN\b/i, message: '无法解析 WebDAV 地址，请检查域名或当前网络 DNS。' },
  { pattern: /\bECONNREFUSED\b/i, message: 'WebDAV 服务拒绝连接，请确认地址和端口正确，服务正在运行。' },
  { pattern: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timeout/i, message: '连接 WebDAV 超时，请稍后重试或检查网络。' },
  { pattern: /\bECONNRESET\b|\bsocket hang up\b/i, message: '连接被 WebDAV 服务中断，请稍后重试。' },
  { pattern: /\bCERT_|certificate|self[- ]signed/i, message: 'WebDAV HTTPS 证书异常，请检查服务端证书配置。' }
]

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

export function normalizeWebDavHost(webdavHost?: string) {
  const trimmed = webdavHost?.trim() ?? ''
  if (!trimmed) return ''
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function describeWebDavUserFacingError(error: unknown, action = '访问 WebDAV') {
  const source = getOriginalError(error)
  const status = getWebDavErrorStatus(source)
  const message = errorMessage(source)
  const prefix = `${action}失败`

  if (status) {
    if (status === 401) {
      return `${prefix}：账号或密码验证失败。请检查 WebDAV 用户名、密码或应用专用密码是否正确。`
    }

    if (status === 403) {
      return `${prefix}：当前账号没有访问这个 WebDAV 目录的权限。请检查目录权限，或换一个有读写权限的目录。`
    }

    if (status === 404) {
      return `${prefix}：找不到远程目录或文件。软件会在同步时自动创建同步目录；如果仍失败，请先在目录选择器里选择一个已存在的上级目录。`
    }

    if (status === 409) {
      return `${prefix}：远程目录结构冲突。请重新选择一个已存在且可写的目录，软件会自动创建需要的子目录。`
    }

    if (status === 423) {
      return `${prefix}：远程目录或文件被 WebDAV 服务锁定。请稍后重试，或在服务端解除锁定。`
    }

    if (status === 429) {
      return `${prefix}：WebDAV 服务限流。软件已经自动重试但仍失败，请稍后再同步。`
    }

    if (status === 507) {
      return `${prefix}：WebDAV 空间不足。请清理远程空间或更换同步目录。`
    }

    if ([408, 500, 502, 503, 504].includes(status)) {
      return `${prefix}：WebDAV 服务暂时不可用或网关超时。软件已经自动重试但仍失败，请稍后再试，或检查 WebDAV 服务商状态。`
    }

    return `${prefix}：WebDAV 返回了无法处理的状态（${status}）。请检查 WebDAV 地址、账号权限和同步目录。`
  }

  const networkMatch = NETWORK_ERROR_PATTERNS.find((item) => item.pattern.test(message))
  if (networkMatch) {
    return `${prefix}：${networkMatch.message}`
  }

  if (/WebDAV host is required/i.test(message)) {
    return `${prefix}：请先填写 WebDAV 地址。`
  }

  if (/Invalid URL|Only absolute URLs|URL/i.test(message)) {
    return `${prefix}：WebDAV 地址格式不正确。请填写完整地址，例如 https://example.com/dav。`
  }

  return `${prefix}：发生未知错误，请检查 WebDAV 地址、账号权限和同步目录后重试。`
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
