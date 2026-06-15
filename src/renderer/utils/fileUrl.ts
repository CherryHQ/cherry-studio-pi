function encodeFileUrlPathSegment(segment: string): string {
  return encodeURIComponent(segment)
}

export function pathToFileUrl(value: string): string {
  if (value.startsWith('file://')) return value

  const normalizedPath = value.replace(/\\/g, '/')

  if (normalizedPath.startsWith('//')) {
    const [host = '', ...segments] = normalizedPath.slice(2).split('/')
    const encodedPath = segments.map(encodeFileUrlPathSegment).join('/')
    return `file://${host}${encodedPath ? `/${encodedPath}` : ''}`
  }

  const absolutePath = /^[A-Za-z]:\//.test(normalizedPath)
    ? `/${normalizedPath}`
    : normalizedPath.startsWith('/')
      ? normalizedPath
      : `/${normalizedPath}`
  const encodedPath = absolutePath
    .split('/')
    .map((segment, index) => (index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeFileUrlPathSegment(segment)))
    .join('/')

  return `file://${encodedPath}`
}

export function fileUrlToPath(value: string | URL): string {
  if (typeof value === 'string' && !value.startsWith('file://')) {
    return value
  }

  let url: URL
  try {
    url = typeof value === 'string' ? new URL(value) : value
  } catch {
    return value.toString()
  }

  if (url.protocol !== 'file:') return typeof value === 'string' ? value : url.toString()

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return value.toString()
  }

  if (url.hostname) return `//${url.hostname}${pathname}`
  if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
  return pathname
}
