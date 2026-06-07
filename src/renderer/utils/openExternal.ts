export function isHttpExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const trimmedValue = value.trim()
  if (!trimmedValue) return false

  try {
    const parsedUrl = new URL(trimmedValue)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

export function openHttpExternalUrl(value: unknown): boolean {
  if (!isHttpExternalUrl(value)) {
    return false
  }

  window.open(value.trim(), '_blank', 'noopener,noreferrer')
  return true
}
