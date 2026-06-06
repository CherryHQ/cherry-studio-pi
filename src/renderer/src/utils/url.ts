export function getUrlOriginOrFallback(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export function getUrlHostname(url: unknown): string | undefined {
  const value = String(url ?? '').trim()
  if (!value) return undefined

  try {
    return new URL(value).hostname || undefined
  } catch {
    return undefined
  }
}

export function getUrlHostnameOrFallback(url: unknown): string {
  const value = String(url ?? '').trim()
  return getUrlHostname(value) || value
}

const CREDENTIAL_LABEL_PATTERN =
  /(?:^|[\s,，;；])(账号|账户|用户名|用户|密码|口令|account|username|user|password|pass|token)\s*[:：=]/i
const ENCODED_LINE_BREAK_PATTERN = /%(?:0d|0a)/i

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  )
}

function isInternalHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized)
  )
}

export function canFetchLinkPreviewMetadata(link: string): boolean {
  const value = link.trim()
  if (!value || /\s/.test(value) || ENCODED_LINE_BREAK_PATTERN.test(value) || CREDENTIAL_LABEL_PATTERN.test(value)) {
    return false
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false
  }
  if (url.username || url.password) {
    return false
  }

  return !isInternalHostname(url.hostname)
}
