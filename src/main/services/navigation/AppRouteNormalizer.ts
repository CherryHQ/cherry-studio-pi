type AppRouteAlias = {
  from: string
  to: string
  preserveRest?: boolean
  restParam?: string
}

const ALLOWED_ROUTE_PREFIXES = ['/', '/home', '/settings', '/app'] as const

const APP_ROUTE_ALIASES: AppRouteAlias[] = [
  { from: '/assistants', to: '/app/chat' },
  { from: '/chat', to: '/app/chat' },
  { from: '/agents', to: '/app/agents', restParam: 'sessionId' },
  { from: '/store', to: '/app/library' },
  { from: '/library', to: '/app/library' },
  { from: '/paintings', to: '/app/paintings', preserveRest: true },
  { from: '/translate', to: '/app/translate' },
  { from: '/files', to: '/app/files' },
  { from: '/notes', to: '/app/notes' },
  { from: '/knowledge', to: '/app/knowledge' },
  { from: '/apps', to: '/app/mini-app', preserveRest: true },
  { from: '/mini-app', to: '/app/mini-app', preserveRest: true },
  { from: '/code', to: '/app/code' },
  { from: '/openclaw', to: '/app/openclaw' },
  { from: '/launchpad', to: '/home' }
]

function splitPathSuffix(route: string) {
  const match = /^([^?#]*)(.*)$/.exec(route)
  return {
    pathname: match?.[1] || '/',
    suffix: match?.[2] || ''
  }
}

function addSuffixParam(suffix: string, key: string, value: string) {
  const hashIndex = suffix.indexOf('#')
  const search = hashIndex >= 0 ? suffix.slice(0, hashIndex) : suffix
  const hash = hashIndex >= 0 ? suffix.slice(hashIndex) : ''
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : '')

  if (!params.has(key)) {
    params.set(key, value)
  }

  const query = params.toString()
  return `${query ? `?${query}` : ''}${hash}`
}

function hasUnsafePathSegment(pathname: string) {
  for (const segment of pathname.split('/')) {
    if (!segment) continue

    let decodedSegment: string
    try {
      decodedSegment = decodeURIComponent(segment)
    } catch {
      return true
    }

    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\') ||
      decodedSegment.includes('\0')
    ) {
      return true
    }
  }

  return false
}

export function normalizeInAppRoute(route: string) {
  const raw = String(route || '/').trim()
  const input = raw.startsWith('/') ? raw : `/${raw}`
  const { pathname, suffix } = splitPathSuffix(input)

  for (const alias of APP_ROUTE_ALIASES) {
    if (pathname !== alias.from && !pathname.startsWith(`${alias.from}/`)) {
      continue
    }

    const rest = pathname.slice(alias.from.length)
    const nextPath = alias.preserveRest ? `${alias.to}${rest}` : alias.to
    const nextSuffix =
      alias.restParam && rest.length > 1 ? addSuffixParam(suffix, alias.restParam, rest.slice(1)) : suffix
    return `${nextPath}${nextSuffix}`
  }

  return input
}

export function isAllowedInAppRoute(route: string) {
  const { pathname } = splitPathSuffix(route)
  if (hasUnsafePathSegment(pathname)) return false
  return ALLOWED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
