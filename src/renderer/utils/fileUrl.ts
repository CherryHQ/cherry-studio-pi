export function fileUrlToPath(value: string | URL): string {
  const url = typeof value === 'string' ? new URL(value) : value
  if (url.protocol !== 'file:') return typeof value === 'string' ? value : url.toString()

  const pathname = decodeURIComponent(url.pathname)
  if (url.hostname) return `//${url.hostname}${pathname}`
  if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
  return pathname
}
