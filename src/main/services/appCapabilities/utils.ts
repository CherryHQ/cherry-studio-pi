import path from 'node:path'

import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { isPathInside } from '@main/utils/file'

const SENSITIVE_KEY_PATTERN = /api[-_]?key|private[-_]?key|token|secret|pass|password|authorization|cookie/i
const CIRCULAR_REFERENCE_PLACEHOLDER = '[Circular]'
const NAVIGATION_ROUTE_PREFIXES = ['/', '/settings', '/knowledge', '/paintings', '/notes', '/agents']
const MAX_AGENT_STRING_CHARS = 8_000
const MAX_AGENT_ARRAY_ITEMS = 200
const MAX_AGENT_OBJECT_KEYS = 200
const MAX_AGENT_OBJECT_DEPTH = 8

export const okResult = <T>(summary: string, data?: T): { ok: true; summary: string; data?: T } => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data })
})

export const sanitizeForAgent = (value: unknown): unknown => {
  const seen = new WeakSet<object>()
  return sanitizeJsonValue(value, '', seen, 0)
}

function sanitizeJsonValue(value: unknown, key: string, seen: WeakSet<object>, depth: number): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    if (typeof value === 'string') return value ? '[redacted]' : value
    if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return value
    return '[redacted]'
  }

  if (typeof value === 'string') {
    if (value.length <= MAX_AGENT_STRING_CHARS) return value
    return `${value.slice(0, MAX_AGENT_STRING_CHARS)}...[truncated ${value.length - MAX_AGENT_STRING_CHARS} chars]`
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (value instanceof Error) {
    if (seen.has(value)) return CIRCULAR_REFERENCE_PLACEHOLDER
    if (depth >= MAX_AGENT_OBJECT_DEPTH) return '[Error truncated]'

    seen.add(value)
    try {
      const output: Record<string, unknown> = {
        name: value.name || 'Error',
        message: value.message
      }
      const errorWithCause = value as Error & { cause?: unknown }
      if ('cause' in errorWithCause) {
        output.cause = sanitizeJsonValue(errorWithCause.cause, 'cause', seen, depth + 1) ?? null
      }

      for (const [childKey, childValue] of Object.entries(value as unknown as Record<string, unknown>)) {
        if (childKey === 'name' || childKey === 'message' || childKey === 'stack' || childKey === 'cause') continue
        const sanitized = sanitizeJsonValue(childValue, childKey, seen, depth + 1)
        if (sanitized !== undefined) output[childKey] = sanitized
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return CIRCULAR_REFERENCE_PLACEHOLDER
  if (depth >= MAX_AGENT_OBJECT_DEPTH) return '[Object truncated]'

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_AGENT_ARRAY_ITEMS)
        .map((item) => sanitizeJsonValue(item, '', seen, depth + 1) ?? null)
      if (value.length > MAX_AGENT_ARRAY_ITEMS) {
        items.push(`[...truncated ${value.length - MAX_AGENT_ARRAY_ITEMS} items...]`)
      }
      return items
    }

    const output: Record<string, unknown> = {}
    const objectValue = value as Record<string, unknown>
    let visitedKeys = 0
    let truncatedKeys = 0
    for (const childKey in objectValue) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, childKey)) continue
      if (visitedKeys >= MAX_AGENT_OBJECT_KEYS) {
        truncatedKeys += 1
        continue
      }
      visitedKeys += 1

      let childValue: unknown
      try {
        childValue = objectValue[childKey]
      } catch {
        output[childKey] = '[Unreadable property]'
        continue
      }

      const sanitized = sanitizeJsonValue(childValue, childKey, seen, depth + 1)
      if (sanitized !== undefined) {
        output[childKey] = sanitized
      }
    }
    if (truncatedKeys > 0) {
      output.__truncatedKeys = truncatedKeys
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
