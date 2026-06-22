function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeMessageText(message: unknown) {
  if (typeof message !== 'string') return null

  const normalizedMessage = message.trim()
  return normalizedMessage.length > 0 ? normalizedMessage : null
}

function parseStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value)
  return null
}

export function extractErrorMessage(error: unknown, seen = new WeakSet<object>()): string | null {
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
  if (status) return `HTTP ${status}`

  const code = normalizeMessageText(source.code)
  return code
}

export function getErrorMessage(error: unknown, fallback = 'Unknown error') {
  return extractErrorMessage(error) ?? fallback
}
