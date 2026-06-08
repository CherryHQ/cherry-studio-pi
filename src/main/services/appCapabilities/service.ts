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

const logger = loggerService.withContext('AppCapabilityService')

function abortReasonMessage(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason.trim()
  return 'Capability call aborted'
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

    try {
      logger.info('Calling app capability', {
        id: capabilityId,
        source: context.source ?? 'system',
        risk: capability.risk,
        dryRun: context.dryRun === true
      })
      return (await capability.execute(input, {
        source: context.source ?? 'system',
        sessionId: context.sessionId,
        toolCallId: context.toolCallId,
        signal: context.signal,
        dryRun: context.dryRun
      })) as AppCapabilityResult<T>
    } catch (error) {
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
