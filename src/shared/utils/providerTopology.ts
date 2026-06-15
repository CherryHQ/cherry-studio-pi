import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const PRIMARY_CHAT_ENDPOINT_PRIORITY: EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
]

export interface ProviderHostTopology {
  primaryEndpoint: EndpointType
  primaryBaseUrl: string
  anthropicBaseUrl: string
  hasAnthropicEndpoint: boolean
}

type LegacyProviderHostFields = Provider & {
  apiHost?: unknown
  anthropicApiHost?: unknown
}

function getLegacyStringField(provider: Provider | undefined, field: 'apiHost' | 'anthropicApiHost') {
  const value = (provider as LegacyProviderHostFields | undefined)?.[field]
  return typeof value === 'string' ? value.trim() : ''
}

function hasEndpointConfig(provider: Provider | undefined, endpoint: EndpointType) {
  return Object.prototype.hasOwnProperty.call(provider?.endpointConfigs ?? {}, endpoint)
}

function resolvePrimaryEndpoint(provider: Provider | undefined): EndpointType {
  if (provider?.defaultChatEndpoint) {
    return provider.defaultChatEndpoint
  }

  for (const endpoint of PRIMARY_CHAT_ENDPOINT_PRIORITY) {
    if (hasEndpointConfig(provider, endpoint)) {
      return endpoint
    }
  }

  return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

export function getProviderHostTopology(provider: Provider | undefined): ProviderHostTopology {
  const primaryEndpoint = resolvePrimaryEndpoint(provider)
  const legacyApiHost = getLegacyStringField(provider, 'apiHost')
  const legacyAnthropicApiHost = getLegacyStringField(provider, 'anthropicApiHost')
  const primaryBaseUrl =
    provider?.endpointConfigs?.[primaryEndpoint]?.baseUrl ??
    (primaryEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? legacyAnthropicApiHost || legacyApiHost : legacyApiHost)
  const anthropicBaseUrl =
    provider?.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl ?? legacyAnthropicApiHost

  return {
    primaryEndpoint,
    primaryBaseUrl,
    anthropicBaseUrl,
    hasAnthropicEndpoint:
      hasEndpointConfig(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES) || Boolean(legacyAnthropicApiHost)
  }
}
