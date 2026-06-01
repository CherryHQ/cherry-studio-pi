import { loggerService } from '@logger'
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

const RISK_LABELS: Record<AppCapabilityRisk, string> = {
  read: '只读',
  write: '会修改应用数据或设置',
  destructive: '高风险，会覆盖或删除数据',
  external: '会调用外部服务或网络能力'
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
    return '没有找到合适的内部能力。可以让 agent 继续收集上下文，或把功能注册为新的 app capability。'
  }

  const approval = needsApproval(recommended.risk)
    ? `这个能力是“${RISK_LABELS[recommended.risk]}”，执行前需要用户确认。`
    : '这个能力是只读的，可以优先用于诊断、查询和规划。'
  return `建议优先使用 ${recommended.id}。${approval}`
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
      ? `系统 Agent 已自动运行 ${successfulAutoRun.capability.id}：${successfulAutoRun.result.summary}`
      : failedAutoRun
        ? `系统 Agent 已尝试 ${failedAutoRun.capability.id}，但诊断失败：${failedAutoRun.result.error || failedAutoRun.result.summary}`
        : blocked[0]
          ? `系统 Agent 找到可处理能力 ${blocked[0].id}，但这是“${RISK_LABELS[blocked[0].risk]}”操作，需要用户确认。`
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
    const capability = appCapabilityService
      .list({ includeHidden: true, includeSchemas: true })
      .find((item) => item.id === id)
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
        error: `${id} 是“${RISK_LABELS[capability.risk]}”能力，需要用户确认后才能执行。`
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
