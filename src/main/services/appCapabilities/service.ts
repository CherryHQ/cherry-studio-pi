import { loggerService } from '@logger'

import { registerAppCapabilities } from './providers'
import { AppCapabilityRegistry } from './registry'
import type {
  AppCapabilityContext,
  AppCapabilityDescriptor,
  AppCapabilityListOptions,
  AppCapabilityResult,
  AppCapabilitySearchOptions
} from './types'
import { sanitizeForAgent } from './utils'

const logger = loggerService.withContext('AppCapabilityService')

function abortReasonMessage(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason.trim()
  return 'Capability call aborted'
}

function sanitizeResultForSource<T>(
  result: AppCapabilityResult<T>,
  source: AppCapabilityContext['source']
): AppCapabilityResult<T> {
  if (source !== 'agent') return result
  return sanitizeForAgent(result) as AppCapabilityResult<T>
}

function invalidCapabilityResult<T>(capabilityId: string, reason: string): AppCapabilityResult<T> {
  const message = `${capabilityId} returned an invalid result: ${reason}`
  return {
    ok: false,
    isError: true,
    summary: message,
    error: message
  }
}

function normalizeCapabilityResult<T>(capabilityId: string, result: unknown): AppCapabilityResult<T> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return invalidCapabilityResult(capabilityId, 'expected an object')
  }

  const candidate = result as Partial<AppCapabilityResult<T>>
  if (typeof candidate.ok !== 'boolean') {
    return invalidCapabilityResult(capabilityId, 'missing boolean ok')
  }

  const summary =
    typeof candidate.summary === 'string' && candidate.summary.trim()
      ? candidate.summary
      : candidate.ok
        ? `${capabilityId} completed`
        : typeof candidate.error === 'string' && candidate.error.trim()
          ? `${capabilityId} failed: ${candidate.error}`
          : `${capabilityId} failed`

  return {
    ...candidate,
    ok: candidate.ok,
    summary,
    ...(candidate.ok ? {} : { isError: true })
  } as AppCapabilityResult<T>
}

export class AppCapabilityService {
  private readonly registry = new AppCapabilityRegistry()
  private initialized = false

  private ensureInitialized() {
    if (this.initialized) return
    registerAppCapabilities(this.registry)
    this.initialized = true
  }

  list(options: AppCapabilityListOptions = {}): AppCapabilityDescriptor[] {
    this.ensureInitialized()
    return this.registry.list(options)
  }

  search(options: AppCapabilitySearchOptions = {}): AppCapabilityDescriptor[] {
    this.ensureInitialized()
    return this.registry.search(options)
  }

  get(id: string, options: Pick<AppCapabilityListOptions, 'includeHidden' | 'includeSchemas'> = {}) {
    this.ensureInitialized()
    return this.registry.getDescriptor(id, options)
  }

  async call<T = unknown>(
    id: string,
    input: unknown = {},
    context: Partial<AppCapabilityContext> = {}
  ): Promise<AppCapabilityResult<T>> {
    this.ensureInitialized()
    const capabilityId = String(id ?? '').trim()
    const displayCapabilityId = capabilityId || '(empty)'
    const capability = this.registry.get(capabilityId)
    if (!capability) {
      return {
        ok: false,
        isError: true,
        summary: `Capability not found: ${displayCapabilityId}`,
        error: `Capability not found: ${displayCapabilityId}`
      }
    }

    if (context.signal?.aborted) {
      const message = abortReasonMessage(context.signal)
      return {
        ok: false,
        isError: true,
        summary: `${capabilityId} aborted: ${message}`,
        error: message
      }
    }

    if (context.dryRun === true && capability.risk !== 'read' && capability.supportsDryRun !== true) {
      const message = `Capability does not support dry run: ${displayCapabilityId}`
      return {
        ok: false,
        isError: true,
        summary: message,
        error: message
      }
    }

    try {
      logger.info('Calling app capability', {
        id: capabilityId,
        source: context.source ?? 'system',
        risk: capability.risk,
        dryRun: context.dryRun === true
      })
      const result = normalizeCapabilityResult<T>(
        capabilityId,
        await capability.execute(input, {
          source: context.source ?? 'system',
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          signal: context.signal,
          dryRun: context.dryRun
        })
      )
      if (context.signal?.aborted) {
        const message = abortReasonMessage(context.signal)
        return {
          ok: false,
          isError: true,
          summary: `${capabilityId} aborted: ${message}`,
          error: message
        }
      }
      return sanitizeResultForSource(result, context.source ?? 'system')
    } catch (error) {
      if (context.signal?.aborted) {
        const message = abortReasonMessage(context.signal)
        return {
          ok: false,
          isError: true,
          summary: `${capabilityId} aborted: ${message}`,
          error: message
        }
      }

      const message = error instanceof Error ? error.message : String(error)
      logger.warn('App capability failed', { id: capabilityId, error: message })
      return {
        ok: false,
        isError: true,
        summary: `${capabilityId} failed: ${message}`,
        error: message
      }
    }
  }
}

export const appCapabilityService = new AppCapabilityService()
