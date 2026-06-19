import { loggerService } from '@logger'
import i18n from '@renderer/i18n'

const logger = loggerService.withContext('SystemAgentService')
const EVENT_DEDUP_MS = 30_000
const MAX_EVENT_DEDUP_MS = 10 * 60_000
const MAX_RECENT_EVENTS = 200
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

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

function dedupeKey(input: SystemAgentEventInput) {
  return [input.type ?? 'event', input.domain ?? '', input.source, input.code ?? '', input.message ?? ''].join('|')
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
  if (options.dedupe !== false && shouldSkipDuplicate(input, options.dedupeMs)) {
    return null
  }

  try {
    const result = await window.api.systemAgent.handleEvent({
      autoRunReadOnly: true,
      ...input
    })

    logger.info('System agent handled event', {
      source: input.source,
      domain: input.domain,
      handled: result?.handled,
      summary: result?.summary
    })

    if (options.showToast && result?.summary) {
      window.toast.info({
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
  return handleSystemAgentEvent(
    {
      type: 'error',
      ...eventInput,
      message: message || errorMessage(error)
    },
    options
  )
}

export function initSystemAgentErrorTriggers() {
  if (systemAgentErrorTriggerState.errorTriggersInitialized) return
  systemAgentErrorTriggerState.errorTriggersInitialized = true

  window.addEventListener('error', (event) => {
    void reportErrorToSystemAgent(event.error || event.message, {
      source: 'renderer.window.error',
      message: event.message,
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void reportErrorToSystemAgent(event.reason, {
      source: 'renderer.window.unhandledrejection'
    })
  })
}
