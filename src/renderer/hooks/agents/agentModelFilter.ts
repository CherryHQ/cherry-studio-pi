import type { AgentType } from '@shared/data/types/agent'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'

const NATIVE_ANTHROPIC_PROVIDER_IDS = new Set(['anthropic'])

export function hasAnthropicMessagesEndpoint(model: Model, provider?: Provider): boolean {
  return (
    model.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) === true ||
    provider?.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ||
    Boolean(provider?.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]) ||
    NATIVE_ANTHROPIC_PROVIDER_IDS.has(provider?.id ?? model.providerId)
  )
}

export function isSelectableAgentModel(model: Model, runtimeType: AgentType | undefined, provider?: Provider): boolean {
  if (isNonChatModel(model)) {
    return false
  }

  if (runtimeType === 'claude-code') {
    return hasAnthropicMessagesEndpoint(model, provider)
  }

  return true
}
