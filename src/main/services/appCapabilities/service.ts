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

  async call<T = unknown>(
    id: string,
    input: unknown = {},
    context: Partial<AppCapabilityContext> = {}
  ): Promise<AppCapabilityResult<T>> {
    this.ensureInitialized()
    const capability = this.registry.get(id)
    if (!capability) {
      return {
        ok: false,
        isError: true,
        summary: `Capability not found: ${id}`,
        error: `Capability not found: ${id}`
      }
    }

    try {
      logger.info('Calling app capability', {
        id,
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
      logger.warn('App capability failed', { id, error: message })
      return {
        ok: false,
        isError: true,
        summary: `${id} failed: ${message}`,
        error: message
      }
    }
  }
}

export const appCapabilityService = new AppCapabilityService()
