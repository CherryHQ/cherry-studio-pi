import path from 'node:path'

import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { isPathInside } from '@main/utils/file'

const SENSITIVE_KEY_PATTERN = /api[-_]?key|token|secret|pass|password|authorization|cookie/i
const CIRCULAR_REFERENCE_PLACEHOLDER = '[Circular]'
const NAVIGATION_ROUTE_PREFIXES = ['/', '/settings', '/knowledge', '/paintings', '/notes', '/agents']

export const okResult = <T>(summary: string, data?: T): { ok: true; summary: string; data?: T } => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data })
})

export const sanitizeForAgent = (value: unknown): unknown => {
  const seen = new WeakSet<object>()
  return sanitizeJsonValue(value, '', seen)
}

function sanitizeJsonValue(value: unknown, key: string, seen: WeakSet<object>): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key) && typeof value === 'string') {
    return value ? '[redacted]' : value
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return CIRCULAR_REFERENCE_PLACEHOLDER

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeJsonValue(item, '', seen) ?? null)
    }

    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeJsonValue(childValue, childKey, seen)
      if (sanitized !== undefined) {
        output[childKey] = sanitized
      }
    }
    return output
  } finally {
    seen.delete(value)
  }
}

export const pickPath = (value: any, keyPath = '') => {
  if (!keyPath) return value
  return keyPath.split('.').reduce((current, key) => current?.[key], value)
}

export const normalizeAppRoute = (route: string) => (route.startsWith('/') ? route : `/${route}`)

export const isAllowedAppRoute = (route: string) =>
  NAVIGATION_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))

export const resolveInsideRoot = (root: string, input?: string, defaultExt?: string) => {
  const raw = (input || '').trim()
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw))
  const resolved = defaultExt && path.extname(candidate) === '' ? `${candidate}${defaultExt}` : candidate
  if (resolved !== root && !isPathInside(resolved, root)) {
    throw new Error('Path is outside the allowed root directory')
  }
  return resolved
}

export const navigateApp = async (route: string) => {
  const nextRoute = normalizeAppRoute(route)
  if (!isAllowedAppRoute(nextRoute)) {
    throw new Error(`Navigation route is not allowed: ${nextRoute}`)
  }

  const win = windowService.getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('Main window is not available')

  await win.webContents.executeJavaScript(`window.navigate(${JSON.stringify(nextRoute)})`)
  if (isMac) windowService.showMainWindow()
}
