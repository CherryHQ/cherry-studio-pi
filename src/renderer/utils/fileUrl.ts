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
