import type { FilePath } from '@shared/file/types/common'
import { toFileUrl } from '@shared/file/urlUtil'

export function pathToFileUrl(value: string): string {
  if (value.startsWith('file://')) return value

  const normalizedPath = value.replace(/\\/g, '/')
  const absolutePath =
    normalizedPath.startsWith('/') || normalizedPath.startsWith('//') || /^[A-Za-z]:\//.test(normalizedPath)
      ? value
      : `/${value}`

  return toFileUrl(absolutePath as FilePath)
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
