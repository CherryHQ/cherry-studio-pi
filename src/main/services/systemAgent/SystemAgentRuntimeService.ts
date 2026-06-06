import { loggerService } from '@logger'
import {
  formatSystemAgentApprovalRequiredError,
  formatSystemAgentAutoRunFailure,
  formatSystemAgentAutoRunSuccess,
  formatSystemAgentBlockedSummary,
  formatSystemAgentGuidance,
  formatSystemAgentNoCapabilityGuidance
} from '@main/i18n/systemAgentMessages'
import {
  type AppCapabilityDescriptor,
  type AppCapabilityListOptions,
  type AppCapabilityResult,
  type AppCapabilityRisk,
  type AppCapabilitySearchOptions,
  appCapabilityService
} from '@main/services/appCapabilities'

const logger = loggerService.withContext('SystemAgentRuntimeService')

export type SystemAgentPlanIntentInput = AppCapabilitySearchOptions & {
  intent?: string
}

export type SystemAgentCapabilityCallOptions = {
  approved?: boolean
  dryRun?: boolean
  sessionId?: string
  toolCallId?: string
}

export type SystemAgentEventInput = {
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

export type SystemAgentIntentPlan = {
  intent: string
  recommended: AppCapabilityDescriptor | null
  capabilities: AppCapabilityDescriptor[]
  guidance: string
}

export type SystemAgentEventPlan = {
  source: string
  query: string
  recommended: AppCapabilityDescriptor | null
  capabilities: AppCapabilityDescriptor[]
  guidance: string
}

export type SystemAgentAutoRun = {
  capability: AppCapabilityDescriptor
  result: AppCapabilityResult
}

export type SystemAgentHandledEvent = {
  source: string
  plan: SystemAgentEventPlan
  autoRuns: SystemAgentAutoRun[]
  blocked: AppCapabilityDescriptor[]
  handled: boolean
  summary: string
}

function needsApproval(risk: AppCapabilityRisk) {
  return risk !== 'read'
}

function makeIntentQuery(input: SystemAgentPlanIntentInput) {
  return String(input.intent || input.query || '').trim()
}

function makeEventQuery(input: SystemAgentEventInput) {
  const eventTerms = input.type === 'error' ? 'error failed diagnose troubleshoot repair' : 'event handle'
  return [eventTerms, input.domain, input.source, input.code, input.message].filter(Boolean).join(' ')
}

function makeGuidance(recommended: AppCapabilityDescriptor | null) {
  if (!recommended) {
    return formatSystemAgentNoCapabilityGuidance()
  }

  return formatSystemAgentGuidance(recommended.id, recommended.risk, needsApproval(recommended.risk))
}

export class SystemAgentRuntimeService {
  listCapabilities(options: AppCapabilityListOptions = {}) {
    return appCapabilityService.list(options)
  }

  planIntent(input: SystemAgentPlanIntentInput): SystemAgentIntentPlan {
    const intent = makeIntentQuery(input)
    const capabilities = appCapabilityService.search({
      query: intent,
      domain: input.domain,
      risk: input.risk,
      includeHidden: input.includeHidden,
      includeSchemas: input.includeSchemas ?? true,
      limit: input.limit ?? 8
    })
    const recommended = capabilities[0] ?? null
    return {
      intent,
      recommended,
      capabilities,
      guidance: makeGuidance(recommended)
    }
  }

  planEvent(input: SystemAgentEventInput): SystemAgentEventPlan {
    const query = makeEventQuery(input)
    const capabilities = appCapabilityService.search({
      query,
      domain: input.domain,
      includeSchemas: true,
      limit: input.limit ?? 6
    })
    const recommended = capabilities[0] ?? null
    return {
      source: input.source,
      query,
      recommended,
      capabilities,
      guidance: makeGuidance(recommended)
    }
  }

  async handleEvent(input: SystemAgentEventInput): Promise<SystemAgentHandledEvent> {
    const plan = this.planEvent(input)
    const autoRuns: SystemAgentAutoRun[] = []

    if (input.autoRunReadOnly !== false) {
      const readOnlyCapability = plan.capabilities.find((capability) => capability.risk === 'read')
      if (readOnlyCapability) {
        const result = await appCapabilityService.call(readOnlyCapability.id, input.capabilityInput ?? {}, {
          source: 'system',
          dryRun: true
        })
        autoRuns.push({ capability: readOnlyCapability, result })
      }
    }

    const blocked = plan.capabilities.filter((capability) => needsApproval(capability.risk)).slice(0, 3)
    const successfulAutoRun = autoRuns.find((item) => item.result.ok)
    const failedAutoRun = autoRuns.find((item) => !item.result.ok)
    const summary = successfulAutoRun
      ? formatSystemAgentAutoRunSuccess(successfulAutoRun.capability.id, successfulAutoRun.result.summary)
      : failedAutoRun
        ? formatSystemAgentAutoRunFailure(
            failedAutoRun.capability.id,
            failedAutoRun.result.error,
            failedAutoRun.result.summary
          )
        : blocked[0]
          ? formatSystemAgentBlockedSummary(blocked[0].id, blocked[0].risk)
          : plan.guidance

    logger.info('Handled system agent event', {
      source: input.source,
      type: input.type ?? 'event',
      autoRuns: autoRuns.map((item) => ({ id: item.capability.id, ok: item.result.ok })),
      blocked: blocked.map((item) => item.id)
    })

    return {
      source: input.source,
      plan,
      autoRuns,
      blocked,
      handled: Boolean(successfulAutoRun),
      summary
    }
  }

  async callCapability<T = unknown>(
    id: string,
    input: unknown = {},
    options: SystemAgentCapabilityCallOptions = {}
  ): Promise<AppCapabilityResult<T>> {
    const capability = appCapabilityService.get(id, { includeHidden: true, includeSchemas: true })
    if (!capability) {
      return {
        ok: false,
        isError: true,
        summary: `Capability not found: ${id}`,
        error: `Capability not found: ${id}`
      }
    }

    if (needsApproval(capability.risk) && options.approved !== true && options.dryRun !== true) {
      return {
        ok: false,
        isError: true,
        summary: `${id} requires approval`,
        error: formatSystemAgentApprovalRequiredError(id, capability.risk)
      }
    }

    logger.info('Calling system agent capability', {
      id,
      risk: capability.risk,
      approved: options.approved === true,
      dryRun: options.dryRun === true
    })

    return appCapabilityService.call<T>(id, input, {
      source: 'ui',
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      dryRun: options.dryRun
    })
  }
}

export const systemAgentRuntimeService = new SystemAgentRuntimeService()
