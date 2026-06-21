import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { isSensitiveAgentKey, redactAgentText } from '@shared/security/redaction'

const logger = loggerService.withContext('SystemAgentService')
const EVENT_DEDUP_MS = 30_000
const MAX_EVENT_DEDUP_MS = 10 * 60_000
const MAX_RECENT_EVENTS = 200
const MAX_EVENT_STRING_CHARS = 8_000
const MAX_EVENT_ARRAY_ITEMS = 100
const MAX_EVENT_OBJECT_KEYS = 100
const MAX_EVENT_OBJECT_DEPTH = 6
const SYSTEM_AGENT_ERROR_TRIGGER_STATE_KEY = '__CHERRY_STUDIO_PI_SYSTEM_AGENT_ERROR_TRIGGER_STATE__'

type SystemAgentEventInput = {
  type?: 'error' | 'event'
  source: string
  message?: string
  code?: string | number
  domain?: string
  details?: unknown
  capabilityInput?: unknown
  autoRunReadOnly?: boolean
  limit?: number
}

type ReportOptions = {
  showToast?: boolean
  dedupe?: boolean
  dedupeMs?: number
}

type SystemAgentErrorTriggerState = {
  errorTriggersInitialized: boolean
  errorListener?: (event: ErrorEvent) => void
  unhandledRejectionListener?: (event: PromiseRejectionEvent) => void
  recentEvents: Map<string, number>
}

type SystemAgentErrorTriggerGlobal = typeof globalThis & {
  [SYSTEM_AGENT_ERROR_TRIGGER_STATE_KEY]?: SystemAgentErrorTriggerState
}

function getSystemAgentErrorTriggerState() {
  const globalState = globalThis as SystemAgentErrorTriggerGlobal
  globalState[SYSTEM_AGENT_ERROR_TRIGGER_STATE_KEY] ??= {
    errorTriggersInitialized: false,
    recentEvents: new Map<string, number>()
  }
  return globalState[SYSTEM_AGENT_ERROR_TRIGGER_STATE_KEY]
}

const systemAgentErrorTriggerState = getSystemAgentErrorTriggerState()
const recentEvents = systemAgentErrorTriggerState.recentEvents

function normalizeMessageText(message: unknown) {
  if (typeof message !== 'string') return null

  const normalizedMessage = message.trim()
  return normalizedMessage.length > 0 ? redactAgentText(normalizedMessage) : null
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return normalizeMessageText(error.message) ?? 'Unknown error'
  if (typeof error === 'string') return normalizeMessageText(error) ?? 'Unknown error'
  if (error == null) return 'Unknown error'

  return normalizeMessageText(String(error)) ?? 'Unknown error'
}

function dedupeKey(input: SystemAgentEventInput) {
  return [input.type ?? 'event', input.domain ?? '', input.source, input.code ?? '', input.message ?? ''].join('|')
}

function sanitizeSystemAgentString(value: string) {
  const redacted = redactAgentText(value)
  if (redacted.length <= MAX_EVENT_STRING_CHARS) return redacted
  return `${redacted.slice(0, MAX_EVENT_STRING_CHARS)}...[truncated ${redacted.length - MAX_EVENT_STRING_CHARS} chars]`
}

function sanitizeSystemAgentValue(value: unknown, key: string, seen: WeakSet<object>, depth: number): unknown {
  if (isSensitiveAgentKey(key)) {
    if (typeof value === 'string') return value ? '[redacted]' : value
    if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return value
    return '[redacted]'
  }

  if (typeof value === 'string') return sanitizeSystemAgentString(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]'
    if (depth >= MAX_EVENT_OBJECT_DEPTH) return '[Error truncated]'

    seen.add(value)
    try {
      const output: Record<string, unknown> = {
        name: value.name || 'Error',
        message: sanitizeSystemAgentString(value.message)
      }
      const errorWithCause = value as Error & { cause?: unknown }
      if ('cause' in errorWithCause) {
        output.cause = sanitizeSystemAgentValue(errorWithCause.cause, 'cause', seen, depth + 1) ?? null
      }

      for (const [childKey, childValue] of Object.entries(value as unknown as Record<string, unknown>)) {
        if (childKey === 'name' || childKey === 'message' || childKey === 'stack' || childKey === 'cause') continue
        const sanitized = sanitizeSystemAgentValue(childValue, childKey, seen, depth + 1)
        if (sanitized !== undefined) output[childKey] = sanitized
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_EVENT_OBJECT_DEPTH) return '[Object truncated]'

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_EVENT_ARRAY_ITEMS)
        .map((item) => sanitizeSystemAgentValue(item, '', seen, depth + 1) ?? null)
      if (value.length > MAX_EVENT_ARRAY_ITEMS) {
        items.push(`[...truncated ${value.length - MAX_EVENT_ARRAY_ITEMS} items...]`)
      }
      return items
    }

    const output: Record<string, unknown> = {}
    const objectValue = value as Record<string, unknown>
    let visitedKeys = 0
    let truncatedKeys = 0
    for (const childKey in objectValue) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, childKey)) continue
      if (visitedKeys >= MAX_EVENT_OBJECT_KEYS) {
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

      const sanitized = sanitizeSystemAgentValue(childValue, childKey, seen, depth + 1)
      if (sanitized !== undefined) output[childKey] = sanitized
    }
    if (truncatedKeys > 0) output.__truncatedKeys = truncatedKeys
    return output
  } finally {
    seen.delete(value)
  }
}

function sanitizeSystemAgentEventInput(input: SystemAgentEventInput): SystemAgentEventInput {
  const sanitized: SystemAgentEventInput = {
    ...input,
    source: sanitizeSystemAgentString(input.source)
  }

  const message = normalizeMessageText(input.message)
  if (message) sanitized.message = message
  else delete sanitized.message

  if (typeof input.domain === 'string') sanitized.domain = sanitizeSystemAgentString(input.domain)
  if (typeof input.code === 'string') sanitized.code = sanitizeSystemAgentString(input.code)
  if ('details' in input) sanitized.details = sanitizeSystemAgentValue(input.details, 'details', new WeakSet(), 0)
  if ('capabilityInput' in input) {
    sanitized.capabilityInput = sanitizeSystemAgentValue(input.capabilityInput, 'capabilityInput', new WeakSet(), 0)
  }

  return sanitized
}

function pruneRecentEvents(now: number, maxAgeMs = EVENT_DEDUP_MS) {
  for (const [key, timestamp] of recentEvents) {
    if (now - timestamp >= maxAgeMs) {
      recentEvents.delete(key)
    }
  }

  while (recentEvents.size > MAX_RECENT_EVENTS) {
    const oldestKey = recentEvents.keys().next().value
    if (!oldestKey) break
    recentEvents.delete(oldestKey)
  }
}

function shouldSkipDuplicate(input: SystemAgentEventInput, dedupeMs = EVENT_DEDUP_MS) {
  const key = dedupeKey(input)
  const now = Date.now()
  const normalizedDedupeMs = Math.min(Math.max(dedupeMs, 0), MAX_EVENT_DEDUP_MS)
  pruneRecentEvents(now, Math.max(EVENT_DEDUP_MS, normalizedDedupeMs))

  const last = recentEvents.get(key) ?? 0
  if (now - last < normalizedDedupeMs) return true
  recentEvents.set(key, now)
  pruneRecentEvents(now, Math.max(EVENT_DEDUP_MS, normalizedDedupeMs))
  return false
}

export async function handleSystemAgentEvent(input: SystemAgentEventInput, options: ReportOptions = {}) {
  const sanitizedInput = sanitizeSystemAgentEventInput(input)

  if (options.dedupe !== false && shouldSkipDuplicate(sanitizedInput, options.dedupeMs)) {
    return null
  }

  try {
    const result = await window.api.systemAgent.handleEvent({
      autoRunReadOnly: true,
      ...sanitizedInput
    })

    logger.info('System agent handled event', {
      source: sanitizedInput.source,
      domain: sanitizedInput.domain,
      handled: result?.handled,
      summary: result?.summary
    })

    if (options.showToast && result?.summary) {
      window.toast?.info({
        title: i18n.t('agent.system_agent.auto_triggered'),
        description: result.summary,
        timeout: 5000
      })
    }

    return result
  } catch (error) {
    logger.warn('System agent failed to handle event', error as Error)
    return null
  }
}

export function reportErrorToSystemAgent(
  error: unknown,
  input: Omit<SystemAgentEventInput, 'type' | 'message'> & { message?: string },
  options: ReportOptions = {}
) {
  const { message, ...eventInput } = input
  const normalizedMessage = normalizeMessageText(message)
  return handleSystemAgentEvent(
    {
      type: 'error',
      ...eventInput,
      message: normalizedMessage ?? errorMessage(error)
    },
    options
  )
}

export function initSystemAgentErrorTriggers() {
  const state = getSystemAgentErrorTriggerState()
  if (state.errorTriggersInitialized) return

  const errorListener = (event: ErrorEvent) => {
    void reportErrorToSystemAgent(event.error || event.message, {
      source: 'renderer.window.error',
      message: event.message,
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    })
  }

  const unhandledRejectionListener = (event: PromiseRejectionEvent) => {
    void reportErrorToSystemAgent(event.reason, {
      source: 'renderer.window.unhandledrejection'
    })
  }

  window.addEventListener('error', errorListener)
  window.addEventListener('unhandledrejection', unhandledRejectionListener)

  state.errorListener = errorListener
  state.unhandledRejectionListener = unhandledRejectionListener
  state.errorTriggersInitialized = true
}

export function unregisterSystemAgentErrorTriggers() {
  const state = getSystemAgentErrorTriggerState()

  if (state.errorListener) {
    window.removeEventListener('error', state.errorListener)
  }

  if (state.unhandledRejectionListener) {
    window.removeEventListener('unhandledrejection', state.unhandledRejectionListener)
  }

  delete state.errorListener
  delete state.unhandledRejectionListener
  state.errorTriggersInitialized = false
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterSystemAgentErrorTriggers()
  })
}
