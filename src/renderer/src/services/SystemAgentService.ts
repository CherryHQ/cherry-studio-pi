import { loggerService } from '@logger'
import i18n from '@renderer/i18n'

const logger = loggerService.withContext('SystemAgentService')
const EVENT_DEDUP_MS = 30_000
const MAX_RECENT_EVENTS = 200
const recentEvents = new Map<string, number>()
let errorTriggersInitialized = false

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
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

function dedupeKey(input: SystemAgentEventInput) {
  return [input.type ?? 'event', input.domain ?? '', input.source, input.code ?? '', input.message ?? ''].join('|')
}

function pruneRecentEvents(now: number) {
  for (const [key, timestamp] of recentEvents) {
    if (now - timestamp >= EVENT_DEDUP_MS) {
      recentEvents.delete(key)
    }
  }

  while (recentEvents.size > MAX_RECENT_EVENTS) {
    const oldestKey = recentEvents.keys().next().value
    if (!oldestKey) break
    recentEvents.delete(oldestKey)
  }
}

function shouldSkipDuplicate(input: SystemAgentEventInput) {
  const key = dedupeKey(input)
  const now = Date.now()
  pruneRecentEvents(now)

  const last = recentEvents.get(key) ?? 0
  if (now - last < EVENT_DEDUP_MS) return true
  recentEvents.set(key, now)
  pruneRecentEvents(now)
  return false
}

export async function handleSystemAgentEvent(input: SystemAgentEventInput, options: ReportOptions = {}) {
  if (options.dedupe !== false && shouldSkipDuplicate(input)) {
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
  return handleSystemAgentEvent(
    {
      type: 'error',
      message: input.message || errorMessage(error),
      ...input
    },
    options
  )
}

export function initSystemAgentErrorTriggers() {
  if (errorTriggersInitialized) return
  errorTriggersInitialized = true

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
