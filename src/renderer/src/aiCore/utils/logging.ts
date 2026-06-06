import type { Assistant, Model, Provider } from '@renderer/types'

import type { ProviderConfig } from '../types'

export function summarizeObjectShapeForLog(input: unknown, depth = 2): unknown {
  if (input == null) return input

  if (Array.isArray(input)) {
    return { type: 'array', length: input.length }
  }

  if (typeof input !== 'object') {
    return { type: typeof input }
  }

  const record = input as Record<string, unknown>
  const keys = Object.keys(record)

  if (depth <= 0) {
    return { type: 'object', keys }
  }

  return {
    type: 'object',
    keys,
    fields: Object.fromEntries(keys.map((key) => [key, summarizeObjectShapeForLog(record[key], depth - 1)]))
  }
}

export function summarizeTextForLog(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    return { value: summarizeObjectShapeForLog(input) }
  }

  return {
    type: 'string',
    length: input.length,
    trimmedLength: input.trim().length,
    isEmpty: input.trim().length === 0
  }
}

export function summarizeMessagesForLog(messages: unknown[]) {
  const roleSampleLimit = 50
  const sampledMessages = messages.slice(0, roleSampleLimit)

  return {
    type: 'array',
    length: messages.length,
    roles: sampledMessages.map((message) => {
      if (!message || typeof message !== 'object') return undefined
      const role = (message as { role?: unknown }).role
      return typeof role === 'string' ? role : undefined
    }),
    truncated: messages.length > roleSampleLimit,
    truncatedCount: Math.max(0, messages.length - roleSampleLimit)
  }
}

export function summarizeTextListForLog(values: unknown[]) {
  const sampleLimit = 50
  const sampledValues = values.slice(0, sampleLimit)

  return {
    type: 'array',
    length: values.length,
    items: sampledValues.map((value) => summarizeTextForLog(value)),
    truncated: values.length > sampleLimit,
    truncatedCount: Math.max(0, values.length - sampleLimit)
  }
}

export function summarizeAssistantForLog(assistant: Assistant) {
  return {
    id: assistant.id,
    name: assistant.name,
    type: assistant.type,
    hasPrompt: Boolean(assistant.prompt),
    settingsKeys: Object.keys(assistant.settings ?? {}),
    mcpServerCount: assistant.mcpServers?.length ?? 0,
    knowledgeBaseCount: assistant.knowledge_bases?.length ?? 0,
    hasModel: Boolean(assistant.model)
  }
}

export function summarizeModelForLog(model: Model) {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    group: model.group,
    endpointType: model.endpoint_type,
    capabilityCount: model.capabilities?.length ?? 0
  }
}

export function summarizeProviderForLog(provider: Provider) {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    isSystem: provider.isSystem,
    isAuthed: provider.isAuthed,
    enabled: provider.enabled,
    authType: provider.authType,
    hasApiKey: Boolean(provider.apiKey),
    hasApiHost: Boolean(provider.apiHost),
    hasAnthropicApiHost: Boolean(provider.anthropicApiHost),
    modelCount: provider.models?.length ?? 0,
    extraHeaderKeys: Object.keys(provider.extra_headers ?? {}),
    apiOptionKeys: Object.keys(provider.apiOptions ?? {}),
    serviceTier: provider.serviceTier,
    verbosity: provider.verbosity,
    isVertex: provider.isVertex
  }
}

export function summarizeProviderConfigForLog(config: ProviderConfig) {
  return {
    providerId: config.providerId,
    endpoint: config.endpoint,
    topLevelKeys: Object.keys(config),
    providerSettings: summarizeObjectShapeForLog(config.providerSettings)
  }
}
