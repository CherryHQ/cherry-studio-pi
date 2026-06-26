import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { getAgentRuntimeApiModelId, resolveAgentRuntimeModel } from '@main/ai/agentSession/modelResolution'
import { application } from '@main/core/application'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost } from '@shared/utils/api'
import { isGeminiProvider } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import type { WarmQueryRequest } from './ClaudeCodeWarmQueryManager'
import { withDeepSeek1mSuffix } from './deepseekContext'
import { createClaudeCodeQueryOptions } from './queryOptions'
import { buildClaudeCodeSessionSettings } from './settingsBuilder'
import type { ClaudeCodeSettings } from './types'

export interface ClaudeCodeAgentSessionQueryRequest extends WarmQueryRequest {
  settings: ClaudeCodeSettings
  sdkModelId: string
}

interface RuntimeModelRef {
  providerId: string
  modelId: string
  apiModelId: string
  provider?: Provider
}

interface ClaudeCodeRuntimeRoute {
  baseUrl?: string
  apiKey?: string
  modelIds: {
    primary: string
    opus: string
    sonnet: string
    haiku: string
  }
}

export async function buildClaudeCodeQueryRequestForAgentSession(
  sessionId: string,
  effectiveResume?: string
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = await agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = await agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined

  const model = await resolveAgentRuntimeModel(agent)
  const { providerId, modelId } = parseUniqueModelId(model.id)
  const provider = await providerService.getByProviderId(providerId)
  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  const route = await resolveClaudeCodeRuntimeRoute(agent, provider, model, modelId, baseUrl)
  const resumeSessionId =
    effectiveResume ?? (await agentSessionMessageService.getLastRuntimeResumeToken(session.id)) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(session, provider, { lastAgentSessionId: resumeSessionId }),
    route
  )
  const sdkModelId = route.modelIds.primary
  const options = createClaudeCodeQueryOptions({
    modelId: sdkModelId,
    settings,
    effectiveResume: resumeSessionId ?? settings.resume
  })

  if (options.includePartialMessages === undefined) {
    options.includePartialMessages = true
  }

  return {
    key: settings.warmQueryKey ?? session.id,
    options,
    initializeTimeoutMs: settings.warmQueryInitializeTimeoutMs,
    settings,
    sdkModelId
  }
}

async function resolveClaudeCodeRuntimeRoute(
  agent: AgentEntity,
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string
): Promise<ClaudeCodeRuntimeRoute> {
  const primaryRef: RuntimeModelRef = {
    providerId: primaryProvider.id,
    modelId: primaryModelId,
    apiModelId: getAgentRuntimeApiModelId(primaryModel),
    provider: primaryProvider
  }
  const opusRef = primaryRef
  const sonnetRef = await resolveRuntimeModelRef(agent.planModel ?? agent.model, primaryRef, agent.id)
  const haikuRef = await resolveRuntimeModelRef(agent.smallModel ?? agent.model, primaryRef, agent.id)
  const modelRefs = [primaryRef, opusRef, sonnetRef, haikuRef]

  const geminiRef = modelRefs.find((ref) => ref.provider && isGeminiProvider(ref.provider))
  if (geminiRef) {
    throw new Error(`Gemini provider models are not supported by Claude Code agents: ${geminiRef.providerId}`)
  }

  const shouldUseGateway = modelRefs.some(
    (ref) => ref.providerId !== primaryProvider.id || !ref.provider || !supportsAnthropicMessages(ref.provider)
  )

  if (shouldUseGateway) {
    const gateway = await resolveApiGatewayRuntime()
    return {
      baseUrl: gateway.baseUrl,
      apiKey: gateway.apiKey,
      modelIds: {
        primary: toGatewayModelId(primaryRef),
        opus: toGatewayModelId(opusRef),
        sonnet: toGatewayModelId(sonnetRef),
        haiku: toGatewayModelId(haikuRef)
      }
    }
  }

  const anthropicBaseUrl = resolveAnthropicBaseUrl(primaryProvider, primaryBaseUrl)
  return {
    baseUrl: anthropicBaseUrl,
    apiKey: await providerService.getRotatedApiKey(primaryProvider.id),
    modelIds: {
      primary: withDeepSeek1mSuffix(primaryRef.apiModelId, anthropicBaseUrl),
      opus: withDeepSeek1mSuffix(opusRef.apiModelId, anthropicBaseUrl),
      sonnet: withDeepSeek1mSuffix(sonnetRef.apiModelId, anthropicBaseUrl),
      haiku: withDeepSeek1mSuffix(haikuRef.apiModelId, anthropicBaseUrl)
    }
  }
}

async function resolveRuntimeModelRef(
  uniqueModelId: UniqueModelId | null | undefined,
  fallback: RuntimeModelRef,
  agentId: string
): Promise<RuntimeModelRef> {
  if (!uniqueModelId) return fallback
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  if (providerId === fallback.providerId && modelId === fallback.modelId) return fallback

  try {
    const [provider, model] = await Promise.all([
      providerService.getByProviderId(providerId).catch(() => undefined),
      resolveAgentRuntimeModel({ id: agentId, model: uniqueModelId }).catch(() =>
        modelService.getByKey(providerId, modelId).catch(() => undefined)
      )
    ])
    return {
      providerId,
      modelId: model?.id ? parseUniqueModelId(model.id).modelId : modelId,
      apiModelId: model ? getAgentRuntimeApiModelId(model) : modelId,
      provider
    }
  } catch {
    return { providerId, modelId, apiModelId: modelId }
  }
}

function supportsAnthropicMessages(provider: Provider): boolean {
  return (
    provider.id === 'anthropic' ||
    provider.presetProviderId === 'anthropic' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ||
    getLegacyAnthropicApiHost(provider).length > 0 ||
    Object.prototype.hasOwnProperty.call(provider.endpointConfigs ?? {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  )
}

async function resolveApiGatewayRuntime(): Promise<{ baseUrl: string; apiKey: string }> {
  const apiGatewayService = application.get('ApiGatewayService')
  const apiKey = await apiGatewayService.ensureValidApiKey()
  if (!apiGatewayService.isRunning()) {
    await apiGatewayService.start()
  }
  const config = apiGatewayService.getCurrentConfig()
  const host = config.host || '127.0.0.1'
  const port = config.port || 23333
  return { baseUrl: `http://${host}:${port}`, apiKey }
}

function toGatewayModelId(ref: RuntimeModelRef): string {
  if (isManagedCherryAiDefaultModel(ref.providerId, ref.apiModelId)) {
    throw new Error('CherryAI managed default model is not available through the API gateway')
  }
  return `${ref.providerId}:${ref.apiModelId}`
}

function resolveAnthropicBaseUrl(provider: Provider, baseUrl: string) {
  // Claude SDK manages API versioning itself — ANTHROPIC_BASE_URL must not include /v1.
  const anthropicEndpointUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const legacyAnthropicApiHost = getLegacyAnthropicApiHost(provider)
  const rawBaseUrl = anthropicEndpointUrl || legacyAnthropicApiHost || baseUrl
  return rawBaseUrl ? formatApiHost(rawBaseUrl, false) : undefined
}

function getLegacyAnthropicApiHost(provider: Provider): string {
  const value = (provider as Provider & { anthropicApiHost?: unknown }).anthropicApiHost
  return typeof value === 'string' ? value.trim() : ''
}

function mergeRuntimeSettings(settings: ClaudeCodeSettings, route: ClaudeCodeRuntimeRoute): ClaudeCodeSettings {
  return {
    ...settings,
    env: {
      ...settings.env,
      ANTHROPIC_MODEL: route.modelIds.primary,
      ANTHROPIC_DEFAULT_OPUS_MODEL: route.modelIds.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: route.modelIds.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: route.modelIds.haiku,
      ...(route.apiKey ? { ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_AUTH_TOKEN: route.apiKey } : {}),
      ...(route.baseUrl ? { ANTHROPIC_BASE_URL: route.baseUrl } : {})
    }
  }
}

export async function buildClaudeCodeWarmQueryRequestForAgentSession(
  sessionId: string
): Promise<WarmQueryRequest | undefined> {
  const request = await buildClaudeCodeQueryRequestForAgentSession(sessionId)
  if (!request) return undefined
  return {
    key: request.key,
    options: request.options,
    initializeTimeoutMs: request.initializeTimeoutMs
  }
}
