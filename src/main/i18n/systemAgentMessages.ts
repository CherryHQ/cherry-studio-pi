import type { AppCapabilityRisk } from '@main/services/appCapabilities'

export const SYSTEM_AGENT_RISK_LABELS: Record<AppCapabilityRisk, string> = {
  read: '只读',
  write: '会修改应用数据或设置',
  destructive: '高风险，会覆盖或删除数据',
  external: '会调用外部服务或网络能力'
}

export const formatSystemAgentNoCapabilityGuidance = () =>
  '没有找到合适的内部能力。可以让 agent 继续收集上下文，或把功能注册为新的 app capability。'

export const formatSystemAgentGuidance = (id: string, risk: AppCapabilityRisk, requiresApproval: boolean) => {
  const approval = requiresApproval
    ? `这个能力是“${SYSTEM_AGENT_RISK_LABELS[risk]}”，执行前需要用户确认。`
    : '这个能力是只读的，可以优先用于诊断、查询和规划。'
  return `建议优先使用 ${id}。${approval}`
}

export const formatSystemAgentAutoRunSuccess = (id: string, summary?: string) =>
  `系统 Agent 已自动运行 ${id}：${summary || ''}`

export const formatSystemAgentAutoRunFailure = (id: string, error?: string, summary?: string) =>
  `系统 Agent 已尝试 ${id}，但诊断失败：${error || summary || ''}`

export const formatSystemAgentBlockedSummary = (id: string, risk: AppCapabilityRisk) =>
  `系统 Agent 找到可处理能力 ${id}，但这是“${SYSTEM_AGENT_RISK_LABELS[risk]}”操作，需要用户确认。`

export const formatSystemAgentApprovalRequiredError = (id: string, risk: AppCapabilityRisk) =>
  `${id} 是“${SYSTEM_AGENT_RISK_LABELS[risk]}”能力，需要用户确认后才能执行。`
