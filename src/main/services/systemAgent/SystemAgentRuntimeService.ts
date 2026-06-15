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
const SYSTEM_AGENT_AUTO_RUN_TIMEOUT_MS = 10_000

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

function canDryRunWithoutApproval(capability: AppCapabilityDescriptor) {
  return capability.supportsDryRun === true
}

function canAutoRunWithoutApproval(capability: AppCapabilityDescriptor) {
  return capability.risk === 'read' || (capability.kind === 'query' && canDryRunWithoutApproval(capability))
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

async function callAutoRunCapability(
  capability: AppCapabilityDescriptor,
  input: unknown
): Promise<AppCapabilityResult> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutResult = new Promise<AppCapabilityResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort()
      resolve({
        ok: false,
        isError: true,
        summary: `${capability.id} timed out`,
        error: `System agent auto-run timed out after ${Math.round(SYSTEM_AGENT_AUTO_RUN_TIMEOUT_MS / 1000)}s`
      })
    }, SYSTEM_AGENT_AUTO_RUN_TIMEOUT_MS)
    timeout.unref?.()
  })

  try {
    return await Promise.race([
      appCapabilityService.call(capability.id, input, {
        source: 'system',
        dryRun: true,
        signal: controller.signal
      }),
      timeoutResult
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
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

  planEvent(input: SystemAgentEventInput, options: { includeSchemas?: boolean } = {}): SystemAgentEventPlan {
    const query = makeEventQuery(input)
    const capabilities = appCapabilityService.search({
      query,
      domain: input.domain,
      includeSchemas: options.includeSchemas ?? true,
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
    const plan = this.planEvent(input, { includeSchemas: false })
    const autoRuns: SystemAgentAutoRun[] = []

    if (input.autoRunReadOnly !== false) {
      const safeCapability = plan.capabilities.find(canAutoRunWithoutApproval)
      if (safeCapability) {
        const result = await callAutoRunCapability(safeCapability, input.capabilityInput ?? {})
        autoRuns.push({ capability: safeCapability, result })
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
    const capabilityId = String(id ?? '').trim()
    const displayCapabilityId = capabilityId || '(empty)'
    const capability = appCapabilityService.get(capabilityId, { includeHidden: true, includeSchemas: false })
    if (!capability) {
      return {
        ok: false,
        isError: true,
        summary: `Capability not found: ${displayCapabilityId}`,
        error: `Capability not found: ${displayCapabilityId}`
      }
    }

    const dryRunAllowed = options.dryRun === true && canDryRunWithoutApproval(capability)
    if (needsApproval(capability.risk) && options.approved !== true && !dryRunAllowed) {
      return {
        ok: false,
        isError: true,
        summary: `${capabilityId} requires approval`,
        error: formatSystemAgentApprovalRequiredError(capabilityId, capability.risk)
      }
    }

    logger.info('Calling system agent capability', {
      id: capabilityId,
      risk: capability.risk,
      approved: options.approved === true,
      dryRun: options.dryRun === true
    })

    return appCapabilityService.call<T>(capabilityId, input, {
      source: 'system',
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      dryRun: options.dryRun
    })
  }
}

export const systemAgentRuntimeService = new SystemAgentRuntimeService()
