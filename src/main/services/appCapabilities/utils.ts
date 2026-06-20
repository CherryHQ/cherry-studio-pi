import path from 'node:path'

import { application } from '@application'
import { isMac } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { isAllowedInAppRoute, normalizeInAppRoute } from '@main/services/navigation/AppRouteNormalizer'
import { isPathInside } from '@main/utils/file'

import { isSensitiveAgentKey, redactAgentText } from './redaction'
import type { AppCapabilityResult } from './types'

const CIRCULAR_REFERENCE_PLACEHOLDER = '[Circular]'
const MAX_AGENT_STRING_CHARS = 8_000
const MAX_AGENT_ARRAY_ITEMS = 200
const MAX_AGENT_OBJECT_KEYS = 200
const MAX_AGENT_OBJECT_DEPTH = 8
const NAVIGATION_TIMEOUT_MS = 5_000

export type { NormalizeBoundedIntegerInputOptions } from './input'
export { normalizeBoundedIntegerInput } from './input'
export { isSensitiveAgentKey, redactAgentText } from './redaction'

export const okResult = <T>(summary: string, data?: T): { ok: true; summary: string; data?: T } => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data })
})

export const sanitizeForAgent = (value: unknown): unknown => {
  const seen = new WeakSet<object>()
  return sanitizeJsonValue(value, '', seen, 0)
}

export const sanitizeAppCapabilityResultForAgent = <T>(result: AppCapabilityResult<T>): AppCapabilityResult<T> => {
  const sanitized = sanitizeForAgent(result) as AppCapabilityResult<T>
  return {
    ...sanitized,
    summary: redactAgentText(sanitized.summary),
    ...(typeof sanitized.error === 'string' ? { error: redactAgentText(sanitized.error) } : {}),
    ...(Array.isArray(sanitized.warnings)
      ? {
          warnings: sanitized.warnings.map((warning) =>
            typeof warning === 'string' ? redactAgentText(warning) : warning
          )
        }
      : {})
  }
}

function sanitizeJsonValue(value: unknown, key: string, seen: WeakSet<object>, depth: number): unknown {
  if (isSensitiveAgentKey(key)) {
    if (typeof value === 'string') return value ? '[redacted]' : value
    if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return value
    return '[redacted]'
  }

  if (typeof value === 'string') {
    const redacted = redactAgentText(value)
    if (redacted.length <= MAX_AGENT_STRING_CHARS) return redacted
    return `${redacted.slice(0, MAX_AGENT_STRING_CHARS)}...[truncated ${redacted.length - MAX_AGENT_STRING_CHARS} chars]`
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (value === null || typeof value === 'boolean') {
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
    if (value instanceof Map) {
      const entries: unknown[] = []
      let visitedItems = 0
      let truncatedItems = 0
      for (const [mapKey, mapValue] of value.entries()) {
        if (visitedItems >= MAX_AGENT_ARRAY_ITEMS) {
          truncatedItems += 1
          continue
        }
        visitedItems += 1

        const keyForRedaction = typeof mapKey === 'string' ? mapKey : ''
        entries.push([
          sanitizeJsonValue(mapKey, 'key', seen, depth + 1) ?? null,
          sanitizeJsonValue(mapValue, keyForRedaction, seen, depth + 1) ?? null
        ])
      }

      return {
        __type: 'Map',
        size: value.size,
        entries,
        ...(truncatedItems > 0 ? { __truncatedEntries: truncatedItems } : {})
      }
    }

    if (value instanceof Set) {
      const values: unknown[] = []
      let visitedItems = 0
      let truncatedItems = 0
      for (const setValue of value.values()) {
        if (visitedItems >= MAX_AGENT_ARRAY_ITEMS) {
          truncatedItems += 1
          continue
        }
        visitedItems += 1
        values.push(sanitizeJsonValue(setValue, '', seen, depth + 1) ?? null)
      }

      return {
        __type: 'Set',
        size: value.size,
        values,
        ...(truncatedItems > 0 ? { __truncatedValues: truncatedItems } : {})
      }
    }

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

export const normalizeAppRoute = (route: string) => {
  return normalizeInAppRoute(route)
}

export const isAllowedAppRoute = (route: string) => isAllowedInAppRoute(normalizeAppRoute(route))

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

  const win = application.get('WindowManager').getWindowsByType(WindowType.Main)[0]
  if (!win || win.isDestroyed()) throw new Error('Main window is not available')

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      win.webContents.executeJavaScript(`window.navigate({ to: ${JSON.stringify(nextRoute)} })`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out navigating app route ${nextRoute} after ${NAVIGATION_TIMEOUT_MS}ms`)),
          NAVIGATION_TIMEOUT_MS
        )
        timeout.unref?.()
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  if (isMac) application.get('MainWindowService').showMainWindow()
}
