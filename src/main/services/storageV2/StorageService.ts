import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type { CreateModelDto, UpdateModelDto } from '@shared/data/api/schemas/models'
import type { CreateProviderDto, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import { isUniqueModelId, type Model as DataApiModel, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, ProviderSettings } from '@shared/data/types/provider'
import { type AuthConfig, AuthConfigSchema } from '@shared/data/types/provider'
import type { Assistant, Provider } from '@types'

import { configManager } from '../ConfigManager'
import { storageV2AgentDbMirrorService } from './AgentDbMirrorService'
import { storageV2BackupService } from './BackupService'
import { storageV2DataApiAgentRuntimeMirrorService } from './DataApiAgentRuntimeMirrorService'
import { storageV2DataRootService } from './DataRootService'
import { storageV2FileLegacyProjectionService } from './FileLegacyProjectionService'
import { storageV2KnowledgeMirrorService } from './KnowledgeMirrorService'
import { storageV2LegacyAgentDbImportService } from './LegacyAgentDbImportService'
import { storageV2LegacyAppDbImportService } from './LegacyAppDbImportService'
import { type StorageV2LegacyDexieImportOptions, storageV2LegacyDexieImportService } from './LegacyDexieImportService'
import { type StorageV2LegacyImportOptions, storageV2LegacyReduxImportService } from './LegacyReduxImportService'
import { listStorageV2LegacyRuntimePolicies, storageV2LegacyRuntimeCleanupService } from './LegacyRuntimeCleanupService'
import { storageV2MigrationAuditService } from './MigrationAuditService'
import { type StorageV2MigrationRunInput, storageV2MigrationRunService } from './MigrationRunService'
import { isSensitiveHeaderName, isStorageV2SecretRefValue } from './SecretFieldDetection'
import { storageV2SecretVaultService } from './SecretVaultService'
import { STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS } from './SettingsSecretFields'
import { storageV2StatisticsService } from './StatisticsService'
import { storageV2Database } from './StorageV2Database'
import {
  storageV2AssistantRepository,
  type StorageV2ConversationImport,
  type StorageV2ConversationImportOptions,
  storageV2ConversationRepository,
  type StorageV2ConversationUpsert,
  type StorageV2ConversationUpsertOptions,
  storageV2FileRepository,
  storageV2KnowledgeRepository,
  type StorageV2ListOptions,
  type StorageV2MessageBlocksUpsertOptions,
  type StorageV2ProviderCredentialRefInput,
  type StorageV2ProviderCredentialRefs,
  storageV2ProviderRepository,
  storageV2SettingsRepository
} from './StorageV2Repositories'
import type { StorageV2HealthSummaryCheck } from './types'

export type StorageV2CoreSnapshotOptions = {
  includeSecrets?: boolean
}

const LLM_SETTINGS_SECRET_FIELDS = [
  {
    path: ['vertexai', 'serviceAccount', 'privateKey'],
    secretRefKey: 'privateKeySecretRef'
  },
  {
    path: ['awsBedrock', 'secretAccessKey'],
    secretRefKey: 'secretAccessKeySecretRef'
  },
  {
    path: ['awsBedrock', 'apiKey'],
    secretRefKey: 'apiKeySecretRef'
  },
  {
    path: ['cherryIn', 'accessToken'],
    secretRefKey: 'accessTokenSecretRef'
  },
  {
    path: ['cherryIn', 'refreshToken'],
    secretRefKey: 'refreshTokenSecretRef'
  }
] as const

const MCP_PROVIDER_TOKEN_KEYS = new Set([
  'mcprouter_token',
  'modelscope_token',
  'tokenLanyunToken',
  'tokenflux_token',
  'ai302_token',
  'bailian_token'
])
const PROVIDER_EXTRA_HEADERS_CREDENTIAL_KIND = 'extraHeaders'
const PROVIDER_EXTRA_HEADER_SCOPES = ['settings', 'providerSettings'] as const
type ProviderExtraHeaderScope = (typeof PROVIDER_EXTRA_HEADER_SCOPES)[number]
type ProviderExtraHeadersCredentialPayload = Partial<Record<ProviderExtraHeaderScope, Record<string, string>>>

function cloneRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {}
  return JSON.parse(JSON.stringify(value)) as Record<string, any>
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getNestedRecord(root: Record<string, any>, path: readonly string[]): Record<string, any> | null {
  let current: unknown = root
  for (const segment of path) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[segment]
  }
  return current && typeof current === 'object' ? (current as Record<string, any>) : null
}

function setNestedValue(root: Record<string, any>, path: readonly string[], value: unknown) {
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') {
      current[segment] = {}
    }
    current = current[segment]
  }
  current[path[path.length - 1]] = value
}

function deleteNestedValue(root: Record<string, any>, path: readonly string[]) {
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') return
    current = current[segment]
  }
  delete current[path[path.length - 1]]
}

function makeStorageV2SecretRef(scope: string, ownerId: string, kind: string) {
  return `storage-v2://secret/${[scope, ownerId, kind].map((part) => encodeURIComponent(part)).join('/')}`
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalArray<T = unknown>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined
}

function optionalRecord<T extends Record<string, unknown> = Record<string, unknown>>(value: unknown): T | undefined {
  return isRecord(value) ? (value as T) : undefined
}

function normalizeProjectionApiKeys(provider: Record<string, unknown>): ApiKeyEntry[] | undefined {
  const keys: ApiKeyEntry[] = []
  const seen = new Set<string>()
  const entries = optionalArray<Record<string, unknown>>(provider.apiKeys)

  if (entries) {
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return
      const key = optionalString(entry.key)
      if (!key || seen.has(key)) return
      seen.add(key)
      keys.push({
        id: optionalString(entry.id) ?? `key-${index + 1}`,
        key,
        ...(optionalString(entry.label) ? { label: optionalString(entry.label) } : {}),
        isEnabled: typeof entry.isEnabled === 'boolean' ? entry.isEnabled : true
      })
    })
  }

  const legacyApiKey = optionalString(provider.apiKey)
  if (legacyApiKey && !seen.has(legacyApiKey)) {
    keys.push({
      id: 'legacy-api-key',
      key: legacyApiKey,
      isEnabled: true
    })
  }

  if (!entries && !legacyApiKey) return undefined
  return keys
}

function normalizeProjectionAuthConfig(provider: Record<string, unknown>): AuthConfig | undefined {
  if (!Object.hasOwn(provider, 'authConfig')) return undefined
  const parsed = AuthConfigSchema.safeParse(provider.authConfig)
  return parsed.success ? parsed.data : undefined
}

function normalizeProjectionProviderSettings(provider: Record<string, unknown>): Partial<ProviderSettings> | undefined {
  return (
    optionalRecord<Partial<ProviderSettings>>(provider.providerSettings) ??
    optionalRecord<Partial<ProviderSettings>>(provider.settings)
  )
}

function normalizeProjectionProvider(provider: unknown): {
  create: CreateProviderDto
  update: UpdateProviderDto
  apiKeys?: ApiKeyEntry[]
} | null {
  if (!isRecord(provider)) return null

  const providerId = optionalString(provider.id)
  const name = optionalString(provider.name) ?? providerId
  if (!providerId || !name) return null

  const apiKeys = normalizeProjectionApiKeys(provider)
  const authConfig = normalizeProjectionAuthConfig(provider)
  const providerSettings = normalizeProjectionProviderSettings(provider)
  const endpointConfigs = optionalRecord(provider.endpointConfigs) as CreateProviderDto['endpointConfigs'] | undefined
  const apiFeatures = optionalRecord(provider.apiFeatures) as CreateProviderDto['apiFeatures'] | undefined
  const defaultChatEndpoint = optionalString(provider.defaultChatEndpoint) as CreateProviderDto['defaultChatEndpoint']
  const providerType = optionalString(provider.type)
  const presetProviderId =
    optionalString(provider.presetProviderId) ??
    (providerType && providerType !== providerId ? providerType : undefined)
  const enabled =
    typeof provider.isEnabled === 'boolean'
      ? provider.isEnabled
      : typeof provider.enabled === 'boolean'
        ? provider.enabled
        : undefined

  const create: CreateProviderDto = {
    providerId,
    name,
    ...(presetProviderId ? { presetProviderId } : {}),
    ...(endpointConfigs ? { endpointConfigs } : {}),
    ...(defaultChatEndpoint ? { defaultChatEndpoint } : {}),
    ...(apiKeys ? { apiKeys } : {}),
    ...(authConfig ? { authConfig } : {}),
    ...(apiFeatures ? { apiFeatures } : {}),
    ...(providerSettings ? { providerSettings } : {})
  }
  const update: UpdateProviderDto = {
    name,
    ...(endpointConfigs ? { endpointConfigs } : {}),
    ...(defaultChatEndpoint ? { defaultChatEndpoint } : {}),
    ...(authConfig ? { authConfig } : {}),
    ...(apiFeatures ? { apiFeatures } : {}),
    ...(providerSettings ? { providerSettings } : {}),
    ...(enabled !== undefined ? { isEnabled: enabled } : {})
  }

  return { create, update, apiKeys }
}

function normalizeProjectionModelId(providerId: string, model: Record<string, unknown>): string | null {
  const apiModelId = optionalString(model.apiModelId) ?? optionalString(model.modelId)
  if (apiModelId) return apiModelId

  const id = optionalString(model.id)
  if (!id) return null
  if (isUniqueModelId(id)) {
    const parsed = parseUniqueModelId(id)
    return parsed.providerId === providerId ? parsed.modelId : null
  }
  return id
}

function normalizeProjectionModel(providerId: string, model: unknown): CreateModelDto | null {
  if (!isRecord(model)) return null
  const modelId = normalizeProjectionModelId(providerId, model)
  if (!modelId) return null

  return {
    providerId,
    modelId,
    ...(optionalString(model.presetModelId) ? { presetModelId: optionalString(model.presetModelId) } : {}),
    ...(optionalString(model.name) ? { name: optionalString(model.name) } : {}),
    ...(optionalString(model.description) ? { description: optionalString(model.description) } : {}),
    ...(optionalString(model.group) ? { group: optionalString(model.group) } : {}),
    ...(optionalArray(model.capabilities) ? { capabilities: optionalArray(model.capabilities) as never } : {}),
    ...(optionalArray(model.inputModalities) ? { inputModalities: optionalArray(model.inputModalities) as never } : {}),
    ...(optionalArray(model.outputModalities)
      ? { outputModalities: optionalArray(model.outputModalities) as never }
      : {}),
    ...(optionalArray(model.endpointTypes) ? { endpointTypes: optionalArray(model.endpointTypes) as never } : {}),
    ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxInputTokens === 'number' ? { maxInputTokens: model.maxInputTokens } : {}),
    ...(typeof model.maxOutputTokens === 'number' ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(typeof model.supportsStreaming === 'boolean' ? { supportsStreaming: model.supportsStreaming } : {}),
    ...(optionalRecord(model.reasoning) ? { reasoning: optionalRecord(model.reasoning) as never } : {}),
    ...(optionalRecord(ownValue(model, 'parameterSupport') ?? ownValue(model, 'parameters'))
      ? {
          parameterSupport: optionalRecord(
            ownValue(model, 'parameterSupport') ?? ownValue(model, 'parameters')
          ) as never
        }
      : {}),
    ...(optionalRecord(model.pricing) ? { pricing: optionalRecord(model.pricing) as never } : {}),
    ...(typeof model.isEnabled === 'boolean' ? { isEnabled: model.isEnabled } : {}),
    ...(typeof model.isHidden === 'boolean' ? { isHidden: model.isHidden } : {}),
    ...(typeof model.isDeprecated === 'boolean' ? { isDeprecated: model.isDeprecated } : {}),
    ...(optionalString(model.notes) ? { notes: optionalString(model.notes) } : {})
  }
}

function toProjectionModelPatch(model: CreateModelDto, source: Record<string, unknown>): UpdateModelDto {
  return {
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(model.description !== undefined ? { description: model.description } : {}),
    ...(model.group !== undefined ? { group: model.group } : {}),
    ...(model.capabilities !== undefined ? { capabilities: model.capabilities } : {}),
    ...(model.inputModalities !== undefined ? { inputModalities: model.inputModalities } : {}),
    ...(model.outputModalities !== undefined ? { outputModalities: model.outputModalities } : {}),
    ...(model.endpointTypes !== undefined ? { endpointTypes: model.endpointTypes } : {}),
    ...(model.parameterSupport !== undefined ? { parameterSupport: model.parameterSupport } : {}),
    ...(model.supportsStreaming !== undefined ? { supportsStreaming: model.supportsStreaming } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxInputTokens !== undefined ? { maxInputTokens: model.maxInputTokens } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.pricing !== undefined ? { pricing: model.pricing } : {}),
    ...(typeof source.isEnabled === 'boolean' ? { isEnabled: source.isEnabled } : {}),
    ...(typeof source.isHidden === 'boolean' ? { isHidden: source.isHidden } : {}),
    ...(typeof source.isDeprecated === 'boolean' ? { isDeprecated: source.isDeprecated } : {}),
    ...(optionalString(source.notes) ? { notes: optionalString(source.notes) } : {})
  }
}

function normalizeProviderCredentialRefs(
  credentialRef?: StorageV2ProviderCredentialRefInput
): StorageV2ProviderCredentialRefs {
  if (!credentialRef) return {}

  if (typeof credentialRef === 'string') {
    return credentialRef.trim() ? { apiKey: credentialRef } : {}
  }

  const refs: StorageV2ProviderCredentialRefs = {}
  for (const [credentialKind, secretRef] of Object.entries(credentialRef)) {
    const kind = credentialKind.trim()
    if (!kind || typeof secretRef !== 'string' || !secretRef.trim()) continue
    refs[kind] = secretRef
  }

  return refs
}

type ProviderApiKeyEntry = {
  id: string
  key: string
  label?: string
  isEnabled: boolean
}

function getProviderApiKeyEntries(provider: Provider): ProviderApiKeyEntry[] {
  const apiKeys = (provider as unknown as { apiKeys?: unknown }).apiKeys
  if (!Array.isArray(apiKeys)) {
    return []
  }

  return apiKeys.flatMap((entry) => {
    if (!isRecord(entry)) return []

    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!id || !key) return []

    return [
      {
        id,
        key,
        ...(typeof entry.label === 'string' && entry.label ? { label: entry.label } : {}),
        isEnabled: entry.isEnabled === true
      }
    ]
  })
}

function selectProviderLegacyApiKey(apiKeys: ProviderApiKeyEntry[]) {
  return apiKeys.find((entry) => entry.isEnabled)?.key ?? apiKeys[0]?.key ?? ''
}

function parseProviderApiKeyEntriesSecret(secret: string): ProviderApiKeyEntry[] | null {
  try {
    const parsed = JSON.parse(secret) as unknown
    if (!Array.isArray(parsed)) return null

    const apiKeys = parsed.flatMap((entry) => {
      if (!isRecord(entry)) return []

      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const key = typeof entry.key === 'string' ? entry.key.trim() : ''
      if (!id || !key) return []

      return [
        {
          id,
          key,
          ...(typeof entry.label === 'string' && entry.label ? { label: entry.label } : {}),
          isEnabled: entry.isEnabled === true
        }
      ]
    })

    return apiKeys.length === parsed.length ? apiKeys : null
  } catch {
    return null
  }
}

function normalizeProviderAuthConfig(value: unknown): AuthConfig | null {
  const parsed = AuthConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function getProviderAuthConfig(provider: Provider): AuthConfig | null {
  return normalizeProviderAuthConfig((provider as unknown as { authConfig?: unknown }).authConfig)
}

function parseProviderAuthConfigSecret(secret: string): AuthConfig | null {
  try {
    return normalizeProviderAuthConfig(JSON.parse(secret) as unknown)
  } catch {
    return null
  }
}

function normalizeProviderExtraHeaderRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null

  const headers = Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' &&
        entry[0].trim().length > 0 &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0
    )
  )

  return Object.keys(headers).length > 0 ? headers : null
}

function parseProviderExtraHeadersSecret(secret: string): ProviderExtraHeadersCredentialPayload | null {
  try {
    const parsed = JSON.parse(secret) as unknown
    const legacyHeaders = normalizeProviderExtraHeaderRecord(parsed)
    if (legacyHeaders) return { settings: legacyHeaders }
    if (!isRecord(parsed)) return null

    const payload: ProviderExtraHeadersCredentialPayload = {}
    for (const scope of PROVIDER_EXTRA_HEADER_SCOPES) {
      const headers = normalizeProviderExtraHeaderRecord(parsed[scope])
      if (headers) payload[scope] = headers
    }

    return Object.keys(payload).length > 0 ? payload : null
  } catch {
    return null
  }
}

function getProviderExtraHeaders(provider: Provider, scope: ProviderExtraHeaderScope): Record<string, string> | null {
  const container = (provider as unknown as Record<string, unknown>)[scope]
  if (!isRecord(container) || !isRecord(container.extraHeaders)) return null

  return Object.fromEntries(
    Object.entries(container.extraHeaders).filter(
      (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
    )
  )
}

function hasProviderExtraHeadersField(provider: Provider) {
  const providerLike = provider as unknown as Record<string, unknown>
  return PROVIDER_EXTRA_HEADER_SCOPES.some((scope) => {
    const container = providerLike[scope]
    return isRecord(container) && Object.hasOwn(container, 'extraHeaders')
  })
}

function getProviderSensitiveExtraHeaders(provider: Provider): ProviderExtraHeadersCredentialPayload {
  const sensitiveByScope: ProviderExtraHeadersCredentialPayload = {}

  for (const scope of PROVIDER_EXTRA_HEADER_SCOPES) {
    const headers = getProviderExtraHeaders(provider, scope)
    if (!headers) continue

    const sensitiveHeaders = Object.fromEntries(
      Object.entries(headers).filter(
        ([headerName, headerValue]) =>
          isSensitiveHeaderName(headerName) && headerValue.trim() && !isStorageV2SecretRefValue(headerValue)
      )
    )
    if (Object.keys(sensitiveHeaders).length > 0) {
      sensitiveByScope[scope] = sensitiveHeaders
    }
  }

  return sensitiveByScope
}

function stripProviderSensitiveExtraHeaders(
  provider: Provider,
  sensitiveHeaders: ProviderExtraHeadersCredentialPayload
) {
  if (Object.keys(sensitiveHeaders).length === 0) return provider

  const providerLike = provider as unknown as Record<string, any>
  const nextProvider = { ...providerLike }
  for (const scope of PROVIDER_EXTRA_HEADER_SCOPES) {
    const sensitiveHeaderNames = new Set(Object.keys(sensitiveHeaders[scope] ?? {}))
    if (sensitiveHeaderNames.size === 0) continue

    const container = isRecord(nextProvider[scope]) ? { ...nextProvider[scope] } : {}
    const extraHeaders = isRecord(container.extraHeaders) ? { ...container.extraHeaders } : {}
    for (const headerName of sensitiveHeaderNames) {
      delete extraHeaders[headerName]
    }
    nextProvider[scope] = {
      ...container,
      extraHeaders
    }
  }

  return nextProvider as unknown as Provider
}

function serializeProviderExtraHeadersSecretPayload(sensitiveHeaders: ProviderExtraHeadersCredentialPayload) {
  const settingsHeaders = sensitiveHeaders.settings
  const providerSettingsHeaders = sensitiveHeaders.providerSettings
  if (settingsHeaders && !providerSettingsHeaders) {
    return JSON.stringify(settingsHeaders)
  }

  return JSON.stringify(sensitiveHeaders)
}

function mergeClearCredentialKinds(
  options: { clearCredentialKinds?: string[]; [key: string]: unknown } | undefined,
  kinds: string[]
): { clearCredentialKinds?: string[] } {
  if (kinds.length === 0) return {}
  return {
    clearCredentialKinds: Array.from(new Set([...(options?.clearCredentialKinds ?? []), ...kinds]))
  }
}

async function prepareProviderExtraHeaderCredentials(provider: Provider): Promise<{
  provider: Provider
  credentialRefs: StorageV2ProviderCredentialRefs
  clearCredentialKinds: string[]
}> {
  const sensitiveHeaders = getProviderSensitiveExtraHeaders(provider)
  const providerForStorage = stripProviderSensitiveExtraHeaders(provider, sensitiveHeaders)
  const credentialRefs: StorageV2ProviderCredentialRefs = {}
  const clearCredentialKinds: string[] = []

  if (Object.keys(sensitiveHeaders).length > 0) {
    credentialRefs[PROVIDER_EXTRA_HEADERS_CREDENTIAL_KIND] = await storageV2SecretVaultService.setSecret(
      'provider',
      provider.id,
      PROVIDER_EXTRA_HEADERS_CREDENTIAL_KIND,
      serializeProviderExtraHeadersSecretPayload(sensitiveHeaders)
    )
  } else if (hasProviderExtraHeadersField(provider)) {
    clearCredentialKinds.push(PROVIDER_EXTRA_HEADERS_CREDENTIAL_KIND)
  }

  return {
    provider: providerForStorage,
    credentialRefs,
    clearCredentialKinds
  }
}

function countStorageV2StatsRecords(counts: Record<string, number>) {
  return Object.values(counts).reduce((total, count) => total + (Number.isFinite(count) ? count : 0), 0)
}

async function restoreMcpStateSecrets(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const servers = Array.isArray(restored.servers) ? restored.servers : []
  let missingSecretCount = 0

  for (const server of servers) {
    if (!isRecord(server)) continue

    const envSecretRefs = isRecord(server.envSecretRefs) ? server.envSecretRefs : null
    if (envSecretRefs) {
      if (!includeSecrets) {
        delete server.env
      } else if (!isRecord(server.env)) {
        server.env = {}
      }

      for (const [key, secretRef] of Object.entries(envSecretRefs)) {
        if (typeof secretRef !== 'string' || !secretRef) continue
        if (!includeSecrets) continue

        const secret = await storageV2SecretVaultService.getSecret(secretRef)
        if (secret) {
          server.env[key] = secret
        } else {
          missingSecretCount++
        }
      }
    }

    if (!includeSecrets) {
      delete server.env
    }

    delete server.envSecretRefs
    delete server.envSecretUnavailable

    if (isRecord(server.env) && Object.keys(server.env).length === 0) {
      delete server.env
    }
  }

  return {
    value: restored,
    missingSecretCount
  }
}

async function restoreMcpProviderTokens(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: Record<string, string>
  missingSecretCount: number
  knownTokenKeys: string[]
}> {
  const restored: Record<string, string> = {}
  const tokens = cloneRecord(value)
  const knownTokenKeys: string[] = []
  let missingSecretCount = 0

  for (const [tokenKey, tokenRecord] of Object.entries(tokens)) {
    if (!MCP_PROVIDER_TOKEN_KEYS.has(tokenKey)) continue
    knownTokenKeys.push(tokenKey)

    if (typeof tokenRecord === 'string' && tokenRecord) {
      if (includeSecrets) {
        restored[tokenKey] = tokenRecord
      }
      continue
    }

    if (!isRecord(tokenRecord)) continue
    const secretRef = tokenRecord.tokenSecretRef
    if (typeof secretRef !== 'string' || !secretRef || !includeSecrets) continue

    const token = await storageV2SecretVaultService.getSecret(secretRef)
    if (token) {
      restored[tokenKey] = token
    } else {
      missingSecretCount++
    }
  }

  return {
    value: restored,
    missingSecretCount,
    knownTokenKeys
  }
}

function sanitizeClearedMcpProviderTokenKeys(value: unknown, knownTokenKeys: Set<string>): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value.filter(
        (item): item is string =>
          typeof item === 'string' && MCP_PROVIDER_TOKEN_KEYS.has(item) && !knownTokenKeys.has(item)
      )
    )
  )
}

async function restoreSecretField(owner: Record<string, any>, field: string, includeSecrets: boolean): Promise<number> {
  const secretRefKey = `${field}SecretRef`
  const unavailableKey = `${field}SecretUnavailable`
  const secretRef = owner[secretRefKey]
  let missingSecretCount = 0

  if (typeof secretRef === 'string' && secretRef && includeSecrets) {
    const secret = await storageV2SecretVaultService.getSecret(secretRef)
    if (secret) {
      owner[field] = secret
    } else {
      missingSecretCount++
    }
  }

  if (!includeSecrets && typeof owner[field] === 'string' && owner[field]) {
    delete owner[field]
  }

  delete owner[secretRefKey]
  delete owner[unavailableKey]

  return missingSecretCount
}

async function restoreFlatSettingsSecretFields(
  settings: Record<string, unknown>,
  includeSecrets: boolean
): Promise<number> {
  let missingSecretCount = 0

  for (const field of STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS) {
    const value = settings[field.key]

    if (isRecord(value)) {
      const secretRef = value.secretRef
      if (typeof secretRef === 'string' && secretRef && includeSecrets) {
        const secret = await storageV2SecretVaultService.getSecret(secretRef)
        if (secret) {
          settings[field.key] = secret
        } else {
          delete settings[field.key]
          missingSecretCount++
        }
      } else {
        delete settings[field.key]
      }
      continue
    }

    if (!includeSecrets && typeof value === 'string' && value) {
      delete settings[field.key]
    }
  }

  return missingSecretCount
}

async function restoreKnowledgeStateSecrets(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const bases = Array.isArray(restored.bases) ? restored.bases : []
  let missingSecretCount = 0

  for (const base of bases) {
    if (!isRecord(base)) continue

    const provider = base.preprocessProvider?.provider
    if (!isRecord(provider)) continue

    missingSecretCount += await restoreSecretField(provider, 'apiKey', includeSecrets)
  }

  return {
    value: restored,
    missingSecretCount
  }
}

async function restoreProviderListSecrets(
  value: unknown,
  fields: string[],
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const providers = Array.isArray(restored.providers) ? restored.providers : []
  let missingSecretCount = 0

  for (const provider of providers) {
    if (!isRecord(provider)) continue

    for (const field of fields) {
      missingSecretCount += await restoreSecretField(provider, field, includeSecrets)
    }
  }

  return {
    value: restored,
    missingSecretCount
  }
}

async function restoreOcrStateSecrets(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const providers = Array.isArray(restored.providers) ? restored.providers : []
  let missingSecretCount = 0

  for (const provider of providers) {
    if (!isRecord(provider)) continue

    const apiConfig = provider.config?.api
    if (!isRecord(apiConfig)) continue

    missingSecretCount += await restoreSecretField(apiConfig, 'apiKey', includeSecrets)
  }

  return {
    value: restored,
    missingSecretCount
  }
}

async function restoreCodeToolsStateSecrets(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const environmentVariableSecretRefs = isRecord(restored.environmentVariableSecretRefs)
    ? restored.environmentVariableSecretRefs
    : null
  let missingSecretCount = 0

  if (environmentVariableSecretRefs) {
    if (!includeSecrets) {
      delete restored.environmentVariables
    } else if (!isRecord(restored.environmentVariables)) {
      restored.environmentVariables = {}
    }

    for (const [toolId, secretRef] of Object.entries(environmentVariableSecretRefs)) {
      if (typeof secretRef !== 'string' || !secretRef || !includeSecrets) continue

      const secret = await storageV2SecretVaultService.getSecret(secretRef)
      if (secret) {
        restored.environmentVariables[toolId] = secret
      } else {
        missingSecretCount++
      }
    }
  }

  delete restored.environmentVariableSecretRefs
  delete restored.environmentVariableSecretUnavailable

  if (!includeSecrets) {
    delete restored.environmentVariables
  }

  return {
    value: restored,
    missingSecretCount
  }
}

async function restoreCopilotStateSecrets(
  value: unknown,
  includeSecrets: boolean
): Promise<{
  value: unknown
  missingSecretCount: number
}> {
  const restored = cloneRecord(value)
  const defaultHeaderSecretRefs = isRecord(restored.defaultHeaderSecretRefs) ? restored.defaultHeaderSecretRefs : null
  let missingSecretCount = 0

  if (!includeSecrets && isRecord(restored.defaultHeaders)) {
    for (const headerName of Object.keys(restored.defaultHeaders)) {
      if (isSensitiveHeaderName(headerName)) {
        delete restored.defaultHeaders[headerName]
      }
    }
  }

  if (defaultHeaderSecretRefs) {
    if (!includeSecrets && isRecord(restored.defaultHeaders)) {
      for (const headerName of Object.keys(defaultHeaderSecretRefs)) {
        delete restored.defaultHeaders[headerName]
      }
    } else if (!isRecord(restored.defaultHeaders)) {
      restored.defaultHeaders = {}
    }

    for (const [headerName, secretRef] of Object.entries(defaultHeaderSecretRefs)) {
      if (typeof secretRef !== 'string' || !secretRef || !includeSecrets) continue

      const secret = await storageV2SecretVaultService.getSecret(secretRef)
      if (secret) {
        restored.defaultHeaders[headerName] = secret
      } else {
        missingSecretCount++
      }
    }
  }

  delete restored.defaultHeaderSecretRefs
  delete restored.defaultHeaderSecretUnavailable

  return {
    value: restored,
    missingSecretCount
  }
}

const DEXIE_AUXILIARY_TABLE_NAMES = [
  'knowledge_notes',
  'quick_phrases',
  'translate_history',
  'translate_languages'
] as const

function assignSettingRecord(
  target: {
    settings: Record<string, unknown>
    llm: Record<string, unknown>
    assistants: Record<string, unknown>
    redux: Record<string, unknown>
    localStorage: Record<string, unknown>
    dexieSettings: Record<string, unknown>
    dexieTables: Record<string, Record<string, unknown>>
  },
  key: string,
  value: unknown
) {
  if (key.startsWith('settings.')) {
    target.settings[key.slice('settings.'.length)] = value
    return
  }

  if (key.startsWith('llm.')) {
    target.llm[key.slice('llm.'.length)] = value
    return
  }

  if (key.startsWith('assistants.')) {
    target.assistants[key.slice('assistants.'.length)] = value
    return
  }

  if (key.startsWith('redux.')) {
    target.redux[key.slice('redux.'.length)] = value
    return
  }

  if (key.startsWith('localStorage.')) {
    target.localStorage[key.slice('localStorage.'.length)] = value
    return
  }

  if (key.startsWith('dexie.settings.')) {
    target.dexieSettings[key.slice('dexie.settings.'.length)] = value
    return
  }

  for (const tableName of DEXIE_AUXILIARY_TABLE_NAMES) {
    const prefix = `dexie.table.${tableName}.`
    if (key.startsWith(prefix)) {
      const rowId = key.slice(prefix.length)
      target.dexieTables[tableName] = target.dexieTables[tableName] ?? {}
      target.dexieTables[tableName][rowId] = value
      return
    }
  }
}

export class StorageV2Service {
  private async flushPendingRuntimeMirrors() {
    await configManager.flushPendingStorageV2ConfigStrict()
    await configManager.mirrorAllToStorageV2()
    await this.flushProviderRuntimeMirrors()
    await storageV2DataApiAgentRuntimeMirrorService.flushStrict()
    await storageV2AgentDbMirrorService.flushStrict()
    await storageV2KnowledgeMirrorService.flushStrict()
  }

  async flushProviderRuntimeMirrors() {
    const providers = await providerService.list({})

    for (const [index, provider] of providers.entries()) {
      const [apiKeys, authConfig, models] = await Promise.all([
        providerService.getApiKeys(provider.id),
        providerService.getAuthConfig(provider.id),
        modelService.list({ providerId: provider.id })
      ])

      await this.upsertProviderModels(provider as never, models, index)
      await this.upsertProviderApiKeys(provider.id, apiKeys)
      await this.upsertProviderAuthConfig(provider.id, authConfig)
    }

    return { mirroredCount: providers.length }
  }

  async projectProvidersToDataApiRuntime(
    options: { apiKeyProviderIds?: ReadonlySet<string>; modelProviderIds?: ReadonlySet<string> } = {}
  ) {
    const snapshot = await this.getCoreSnapshot({ includeSecrets: true })
    const llm = optionalRecord(snapshot.llm)
    const providers = optionalArray<Record<string, unknown>>(llm?.providers) ?? []
    const apiKeyProviderIds = options.apiKeyProviderIds
    const apiKeyCredentialRefsByProvider = apiKeyProviderIds
      ? await storageV2ProviderRepository.listCredentialRefs()
      : null
    const modelProviderIds = options.modelProviderIds
    let providerCount = 0
    let modelCount = 0

    for (const provider of providers) {
      const normalized = normalizeProjectionProvider(provider)
      if (!normalized) continue

      const providerId = normalized.create.providerId
      const providerApiKeysRequested = apiKeyProviderIds?.has(providerId) === true
      const credentialRefs = providerApiKeysRequested ? apiKeyCredentialRefsByProvider?.get(providerId) : undefined
      const hasStoredApiKeyRef = Boolean(credentialRefs?.apiKeys || credentialRefs?.apiKey)

      if (providerApiKeysRequested && hasStoredApiKeyRef && normalized.apiKeys === undefined) {
        throw new Error(
          `Storage v2 服务商 ${providerId} 声明了 API Key 凭据，但本机密钥库未能恢复出密钥值。为避免清空现有模型服务商密钥，本次运行时投影已停止。`
        )
      }

      const exists = await this.dataApiProviderExists(providerId)
      if (exists) {
        await providerService.update(providerId, normalized.update)
      } else {
        await providerService.create(normalized.create)
        if (Object.keys(normalized.update).length > 0) {
          await providerService.update(providerId, normalized.update)
        }
      }

      if (apiKeyProviderIds) {
        if (apiKeyProviderIds.has(providerId)) {
          await providerService.replaceApiKeys(providerId, hasStoredApiKeyRef ? (normalized.apiKeys ?? []) : [])
        }
      } else if (normalized.apiKeys) {
        await providerService.replaceApiKeys(providerId, normalized.apiKeys)
      }

      const projectedModelCount =
        !modelProviderIds || modelProviderIds.has(providerId)
          ? await this.projectProviderModelsToDataApiRuntime(providerId, provider.models)
          : 0
      providerCount += 1
      modelCount += projectedModelCount
    }

    return { providerCount, modelCount }
  }

  private async dataApiProviderExists(providerId: string) {
    try {
      await providerService.getByProviderId(providerId)
      return true
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return false
      }
      throw error
    }
  }

  private async projectProviderModelsToDataApiRuntime(providerId: string, rawModels: unknown) {
    const sourceModels = optionalArray<Record<string, unknown>>(rawModels)
    if (!sourceModels) return 0

    const remoteModels = sourceModels.flatMap((source) => {
      const model = normalizeProjectionModel(providerId, source)
      return model ? [{ model, source }] : []
    })
    const localModels = await modelService.list({ providerId })
    const localByModelId = new Map(localModels.map((model: DataApiModel) => [model.apiModelId, model]))
    const remoteModelIds = new Set(remoteModels.map(({ model }) => model.modelId))
    const toAdd = remoteModels
      .filter(({ model }) => !localByModelId.has(model.modelId))
      .map(({ model }) => ({ dto: model }))
    const toRemove = localModels
      .filter((model: DataApiModel) => typeof model.apiModelId === 'string' && !remoteModelIds.has(model.apiModelId))
      .map((model: DataApiModel) => model.id)
    const toUpdate = remoteModels
      .filter(({ model }) => localByModelId.has(model.modelId))
      .map(({ model, source }) => ({
        providerId,
        modelId: model.modelId,
        patch: toProjectionModelPatch(model, source)
      }))

    if (toAdd.length > 0 || toRemove.length > 0) {
      await modelService.reconcileForProvider(providerId, { toAdd, toRemove })
    }
    if (toUpdate.length > 0) {
      await modelService.bulkUpdate(toUpdate)
    }

    return remoteModels.length
  }

  getDataRoot() {
    return storageV2DataRootService.resolveDataRoot()
  }

  async healthCheck() {
    return storageV2Database.healthCheck()
  }

  async createSnapshot(reason: string = 'manual') {
    await this.flushPendingRuntimeMirrors()
    return storageV2Database.createSnapshot(reason)
  }

  async createBackup(reason: string = 'manual') {
    await this.flushPendingRuntimeMirrors()
    return storageV2BackupService.createBackup(reason)
  }

  async getBackupOverview() {
    return storageV2BackupService.getBackupOverview()
  }

  async validateBackup(backupPath: string) {
    return storageV2BackupService.validateBackup(backupPath)
  }

  async restoreBackup(backupPath: string) {
    await this.flushPendingRuntimeMirrors()
    return storageV2BackupService.restoreBackup(backupPath)
  }

  async getMigrationAudit() {
    return storageV2MigrationAuditService.runAudit()
  }

  getLegacyRuntimePolicies() {
    return listStorageV2LegacyRuntimePolicies()
  }

  async getSensitiveLegacyProjectionCleanupPlan() {
    return storageV2LegacyRuntimeCleanupService.getSensitiveLegacyProjectionPlan()
  }

  async cleanupSensitiveLegacyProjections(options?: { dryRun?: boolean }) {
    await this.flushPendingRuntimeMirrors()
    return storageV2LegacyRuntimeCleanupService.cleanupSensitiveLegacyProjections(options)
  }

  async getStats() {
    return storageV2StatisticsService.getStats()
  }

  async getIntegrityReport() {
    return storageV2Database.integrityReport()
  }

  async getHealthSummary() {
    const checks: StorageV2HealthSummaryCheck[] = []
    const dataRootInfo = this.getDataRoot()

    try {
      const health = await this.healthCheck()
      checks.push({
        id: 'storage_health',
        label: 'Storage health',
        status: health.ok ? 'ok' : 'error',
        message: health.ok ? 'Storage quick_check passed.' : `Storage quick_check failed: ${health.quickCheck}`,
        values: {
          quickCheck: health.quickCheck
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push({
        id: 'storage_health',
        label: 'Storage health',
        status: 'error',
        message: `Storage health check failed: ${message}`,
        values: { message }
      })
    }

    try {
      const integrity = await this.getIntegrityReport()
      checks.push({
        id: 'integrity',
        label: 'Integrity',
        status: integrity.ok ? 'ok' : 'error',
        message: integrity.ok
          ? 'Storage integrity report is clean.'
          : `Storage integrity report has ${integrity.issues.length} issue(s).`,
        values: {
          count: integrity.issues.length,
          foreignKeyIssueCount: integrity.foreignKeyIssueCount
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push({
        id: 'integrity',
        label: 'Integrity',
        status: 'error',
        message: `Storage integrity report failed: ${message}`,
        values: { message }
      })
    }

    try {
      const audit = await this.getMigrationAudit()
      const legacyOnlyCount = audit.items.filter(
        (item) => item.exists && item.coverage === 'legacy-only' && item.actionRequired
      ).length
      checks.push({
        id: 'legacy_only_paths',
        label: 'Legacy-only paths',
        status: legacyOnlyCount > 0 ? 'warning' : 'ok',
        message:
          legacyOnlyCount > 0
            ? `${legacyOnlyCount} legacy-only path(s) need handling before final migration.`
            : 'No action-required legacy-only paths were detected.',
        values: { count: legacyOnlyCount }
      })
      checks.push({
        id: 'audit_warnings',
        label: 'Audit warnings',
        status: audit.warnings.length > 0 ? 'warning' : 'ok',
        message:
          audit.warnings.length > 0
            ? `${audit.warnings.length} migration audit warning(s) need review.`
            : 'Migration audit has no warnings.',
        values: { count: audit.warnings.length }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push({
        id: 'audit_warnings',
        label: 'Audit warnings',
        status: 'error',
        message: `Migration audit failed: ${message}`,
        values: { message }
      })
    }

    try {
      const stats = await this.getStats()
      const recordCount = countStorageV2StatsRecords(stats.counts)
      checks.push({
        id: 'record_coverage',
        label: 'Record coverage',
        status: recordCount > 0 ? 'ok' : 'warning',
        message:
          recordCount > 0
            ? `Storage v2 contains ${recordCount} record(s).`
            : 'Storage v2 has no records yet; run migration before relying on backup or restore.',
        values: { count: recordCount }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push({
        id: 'record_coverage',
        label: 'Record coverage',
        status: 'warning',
        message: `Storage v2 stats failed: ${message}`,
        values: { message }
      })
    }

    const issueCount = checks.filter((check) => check.status === 'error').length
    const warningCount = checks.filter((check) => check.status === 'warning').length
    const legacyOnlyCheck = checks.find((check) => check.id === 'legacy_only_paths')
    const status = issueCount > 0 ? 'blocked' : warningCount > 0 ? 'warning' : 'ready'

    return {
      generatedAt: new Date().toISOString(),
      status,
      canBackup: issueCount === 0,
      canMigrate: issueCount === 0 && legacyOnlyCheck?.status !== 'warning',
      dataRoot: dataRootInfo.dataRoot,
      issueCount,
      warningCount,
      checks
    }
  }

  async getCoreSnapshot(options: StorageV2CoreSnapshotOptions = {}) {
    const [settingsRecords, providers, assistants, conversations] = await Promise.all([
      storageV2SettingsRepository.list(),
      storageV2ProviderRepository.list(),
      storageV2AssistantRepository.list(),
      storageV2ConversationRepository.list({ ownerType: 'assistant' })
    ])
    const state = {
      settings: {} as Record<string, unknown>,
      llm: {} as Record<string, unknown>,
      assistants: {} as Record<string, unknown>,
      redux: {} as Record<string, unknown>,
      localStorage: {} as Record<string, unknown>,
      dexieSettings: {} as Record<string, unknown>,
      dexieTables: {} as Record<string, Record<string, unknown>>
    }
    const includeSecrets = options.includeSecrets === true
    const credentialRefsByProvider = includeSecrets
      ? await storageV2ProviderRepository.listCredentialRefs()
      : new Map<string, Record<string, string>>()
    let missingSecretCount = 0

    for (const record of settingsRecords) {
      assignSettingRecord(state, record.key, record.value)
    }

    if (isRecord(state.settings.s3)) {
      missingSecretCount += await restoreSecretField(state.settings.s3, 'secretAccessKey', includeSecrets)
    }

    if (isRecord(state.settings.apiServer)) {
      missingSecretCount += await restoreSecretField(state.settings.apiServer, 'apiKey', includeSecrets)
    }

    missingSecretCount += await restoreFlatSettingsSecretFields(state.settings, includeSecrets)

    const llmSettings = cloneRecord(state.llm.settings)
    if (includeSecrets) {
      for (const field of LLM_SETTINGS_SECRET_FIELDS) {
        const parent = getNestedRecord(llmSettings, field.path.slice(0, -1))
        const secretRef = parent?.[field.secretRefKey]
        if (typeof secretRef === 'string' && secretRef) {
          const secret = await storageV2SecretVaultService.getSecret(secretRef)
          if (secret) {
            setNestedValue(llmSettings, field.path, secret)
          } else {
            missingSecretCount++
          }
        }
      }
    }

    for (const field of LLM_SETTINGS_SECRET_FIELDS) {
      if (!includeSecrets) {
        deleteNestedValue(llmSettings, field.path)
      }
      deleteNestedValue(llmSettings, [...field.path.slice(0, -1), field.secretRefKey])
      deleteNestedValue(llmSettings, [...field.path.slice(0, -1), `${field.path.at(-1)}SecretUnavailable`])
    }

    if (Object.keys(llmSettings).length > 0) {
      state.llm.settings = llmSettings
    }

    const providerSnapshots = await Promise.all(
      providers.map(async (provider) => {
        const snapshot: Record<string, unknown> = provider.config ? { ...provider.config } : {}
        Object.assign(snapshot, {
          id: provider.id,
          type: provider.type,
          name: provider.name,
          apiHost: provider.apiHost ?? undefined,
          enabled: provider.enabled,
          models: provider.models
        })

        if (includeSecrets) {
          const providerCredentialRefs = credentialRefsByProvider.get(provider.id) ?? {}
          const storedApiKeysRef = providerCredentialRefs.apiKeys
          const fallbackApiKeysRef = makeStorageV2SecretRef('provider', provider.id, 'apiKeys')
          const apiKeysRefs = Array.from(new Set([storedApiKeysRef, fallbackApiKeysRef].filter(isNonEmptyString)))
          let restoredApiKeys = false

          for (const apiKeysRef of apiKeysRefs) {
            const apiKeysSecret = await storageV2SecretVaultService.getSecret(apiKeysRef)
            if (!apiKeysSecret) continue

            const apiKeys = parseProviderApiKeyEntriesSecret(apiKeysSecret)
            if (apiKeys) {
              snapshot.apiKeys = apiKeys
              snapshot.apiKey = selectProviderLegacyApiKey(apiKeys)
              restoredApiKeys = true
              break
            }
          }

          if (storedApiKeysRef && !restoredApiKeys) {
            missingSecretCount++
          }

          const storedApiKeyRef = providerCredentialRefs.apiKey
          const fallbackApiKeyRef = makeStorageV2SecretRef('provider', provider.id, 'apiKey')
          const apiKeyRefs = Array.from(new Set([storedApiKeyRef, fallbackApiKeyRef].filter(isNonEmptyString)))
          let restoredApiKey = false

          for (const apiKeyRef of apiKeyRefs) {
            const apiKey = await storageV2SecretVaultService.getSecret(apiKeyRef)
            if (apiKey) {
              snapshot.apiKey = apiKey
              restoredApiKey = true
              break
            }
          }

          if (storedApiKeyRef && !restoredApiKey) {
            missingSecretCount++
          }

          const storedAuthConfigRef = providerCredentialRefs.authConfig
          const fallbackAuthConfigRef = makeStorageV2SecretRef('provider', provider.id, 'authConfig')
          const authConfigRefs = Array.from(
            new Set([storedAuthConfigRef, fallbackAuthConfigRef].filter(isNonEmptyString))
          )
          let restoredAuthConfig = false

          for (const authConfigRef of authConfigRefs) {
            const authConfigSecret = await storageV2SecretVaultService.getSecret(authConfigRef)
            if (!authConfigSecret) continue

            const authConfig = parseProviderAuthConfigSecret(authConfigSecret)
            if (authConfig) {
              snapshot.authConfig = authConfig
              restoredAuthConfig = true
              break
            }
          }

          if (storedAuthConfigRef && !restoredAuthConfig) {
            missingSecretCount++
          }

          const storedExtraHeadersRef = providerCredentialRefs.extraHeaders
          if (storedExtraHeadersRef) {
            const extraHeadersSecret = await storageV2SecretVaultService.getSecret(storedExtraHeadersRef)
            const extraHeadersByScope = extraHeadersSecret ? parseProviderExtraHeadersSecret(extraHeadersSecret) : null
            if (extraHeadersByScope) {
              for (const scope of PROVIDER_EXTRA_HEADER_SCOPES) {
                const extraHeaders = extraHeadersByScope[scope]
                if (!extraHeaders) continue

                const container = isRecord(snapshot[scope]) ? { ...snapshot[scope] } : {}
                const currentHeaders = isRecord(container.extraHeaders) ? container.extraHeaders : {}
                snapshot[scope] = {
                  ...container,
                  extraHeaders: {
                    ...currentHeaders,
                    ...extraHeaders
                  }
                }
              }
            } else {
              missingSecretCount++
            }
          }
        }

        return snapshot
      })
    )
    state.llm.providers = providerSnapshots

    if (state.redux.codeTools) {
      const restoredCodeToolsState = await restoreCodeToolsStateSecrets(state.redux.codeTools, includeSecrets)
      state.redux.codeTools = restoredCodeToolsState.value
      missingSecretCount += restoredCodeToolsState.missingSecretCount
    }

    if (state.redux.copilot) {
      const restoredCopilotState = await restoreCopilotStateSecrets(state.redux.copilot, includeSecrets)
      state.redux.copilot = restoredCopilotState.value
      missingSecretCount += restoredCopilotState.missingSecretCount
    }

    if (state.redux.mcp) {
      const restoredMcpState = await restoreMcpStateSecrets(state.redux.mcp, includeSecrets)
      state.redux.mcp = restoredMcpState.value
      missingSecretCount += restoredMcpState.missingSecretCount
    }

    const hasRecoverableReduxKnowledge =
      isRecord(state.redux.knowledge) &&
      Array.isArray(state.redux.knowledge.bases) &&
      state.redux.knowledge.bases.length > 0

    if (!hasRecoverableReduxKnowledge) {
      const knowledgeBases = await storageV2KnowledgeRepository.listBases()
      if (knowledgeBases.length > 0) {
        state.redux.knowledge = { bases: knowledgeBases }
      }
    }

    if (state.redux.knowledge) {
      const restoredKnowledgeState = await restoreKnowledgeStateSecrets(state.redux.knowledge, includeSecrets)
      state.redux.knowledge = restoredKnowledgeState.value
      missingSecretCount += restoredKnowledgeState.missingSecretCount
    }

    if (state.redux.nutstore) {
      const restoredNutstoreState = cloneRecord(state.redux.nutstore)
      missingSecretCount += await restoreSecretField(restoredNutstoreState, 'nutstoreToken', includeSecrets)
      state.redux.nutstore = restoredNutstoreState
    }

    if (state.redux.ocr) {
      const restoredOcrState = await restoreOcrStateSecrets(state.redux.ocr, includeSecrets)
      state.redux.ocr = restoredOcrState.value
      missingSecretCount += restoredOcrState.missingSecretCount
    }

    if (state.redux.preprocess) {
      const restoredPreprocessState = await restoreProviderListSecrets(
        state.redux.preprocess,
        ['apiKey'],
        includeSecrets
      )
      state.redux.preprocess = restoredPreprocessState.value
      missingSecretCount += restoredPreprocessState.missingSecretCount
    }

    if (state.redux.websearch) {
      const restoredWebSearchState = await restoreProviderListSecrets(
        state.redux.websearch,
        ['apiKey', 'basicAuthPassword'],
        includeSecrets
      )
      state.redux.websearch = restoredWebSearchState.value
      missingSecretCount += restoredWebSearchState.missingSecretCount
    }

    let knownMcpProviderTokenKeys = new Set<string>()
    if (state.localStorage.mcpProviderTokens) {
      const restoredMcpProviderTokens = await restoreMcpProviderTokens(
        state.localStorage.mcpProviderTokens,
        includeSecrets
      )
      state.localStorage.mcpProviderTokens = restoredMcpProviderTokens.value
      knownMcpProviderTokenKeys = new Set(restoredMcpProviderTokens.knownTokenKeys)
      missingSecretCount += restoredMcpProviderTokens.missingSecretCount
    }

    if (state.localStorage.clearedMcpProviderTokenKeys) {
      state.localStorage.clearedMcpProviderTokenKeys = sanitizeClearedMcpProviderTokenKeys(
        state.localStorage.clearedMcpProviderTokenKeys,
        knownMcpProviderTokenKeys
      )
    }

    const topicsByAssistantId = new Map<string, Array<Record<string, unknown>>>()
    for (const conversation of conversations) {
      const topics = topicsByAssistantId.get(conversation.ownerId) ?? []
      topics.push({
        id: conversation.id,
        type: 'chat',
        assistantId: conversation.ownerId,
        name: conversation.title ?? conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: [],
        pinned: conversation.pinned
      })
      topicsByAssistantId.set(conversation.ownerId, topics)
    }

    const assistantSnapshots = assistants.map((assistant) => ({
      ...(Object.keys(assistant.snapshot).length > 0
        ? assistant.snapshot
        : {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description,
            prompt: assistant.prompt,
            settings: assistant.settings,
            tags: assistant.tags
          }),
      topics: topicsByAssistantId.get(assistant.id) ?? []
    }))
    state.assistants.assistants = assistantSnapshots

    if (state.assistants.defaultAssistant && typeof state.assistants.defaultAssistant === 'object') {
      const defaultAssistant = state.assistants.defaultAssistant as Record<string, any>
      defaultAssistant.topics = topicsByAssistantId.get(String(defaultAssistant.id)) ?? []
    }

    if (Array.isArray(state.assistants.presets)) {
      state.assistants.presets = state.assistants.presets.map((preset) =>
        preset && typeof preset === 'object' ? { ...preset, topics: [] } : preset
      )
    }

    return {
      generatedAt: new Date().toISOString(),
      settings: state.settings,
      llm: state.llm,
      assistants: state.assistants,
      redux: state.redux,
      localStorage: state.localStorage,
      dexieSettings: state.dexieSettings,
      dexieTables: state.dexieTables,
      metadata: {
        includeSecrets,
        settingCount: settingsRecords.length,
        providerCount: providers.length,
        assistantCount: assistants.length,
        topicCount: conversations.length,
        reduxSliceCount: Object.keys(state.redux).length,
        dexieTableRowCount: Object.values(state.dexieTables).reduce(
          (count, rowsById) => count + Object.keys(rowsById).length,
          0
        ),
        missingSecretCount
      }
    }
  }

  async recordMigrationRun(input: StorageV2MigrationRunInput) {
    return storageV2MigrationRunService.recordRun(input)
  }

  async listMigrationRuns(limit?: number) {
    return storageV2MigrationRunService.listRuns(limit)
  }

  async getSetting(key: string) {
    return storageV2SettingsRepository.get(key)
  }

  async setSetting(key: string, value: unknown, scope?: string) {
    return storageV2SettingsRepository.set(key, value, scope)
  }

  async listSettings(scope?: string) {
    return storageV2SettingsRepository.list(scope)
  }

  async listProviders() {
    return storageV2ProviderRepository.list()
  }

  async upsertProvider(
    provider: Provider,
    sortOrder?: number,
    credentialRef?: StorageV2ProviderCredentialRefInput,
    options: { clearCredential?: boolean; preserveExistingCredential?: boolean } = {}
  ) {
    let nextCredentialRef = credentialRef
    const credentialRefs = normalizeProviderCredentialRefs(nextCredentialRef)

    if (!nextCredentialRef) {
      const providerApiKeys = getProviderApiKeyEntries(provider)
      const authConfig = getProviderAuthConfig(provider)

      if (provider.apiKey) {
        credentialRefs.apiKey = await storageV2SecretVaultService.setSecret(
          'provider',
          provider.id,
          'apiKey',
          provider.apiKey
        )
      }

      if (providerApiKeys.length > 0) {
        credentialRefs.apiKeys = await storageV2SecretVaultService.setSecret(
          'provider',
          provider.id,
          'apiKeys',
          JSON.stringify(providerApiKeys)
        )

        const legacyApiKey = selectProviderLegacyApiKey(providerApiKeys)
        if (legacyApiKey && !credentialRefs.apiKey) {
          credentialRefs.apiKey = await storageV2SecretVaultService.setSecret(
            'provider',
            provider.id,
            'apiKey',
            legacyApiKey
          )
        }
      }

      if (authConfig) {
        credentialRefs.authConfig = await storageV2SecretVaultService.setSecret(
          'provider',
          provider.id,
          'authConfig',
          JSON.stringify(authConfig)
        )
      }

      nextCredentialRef = Object.keys(credentialRefs).length > 0 ? credentialRefs : undefined
    }
    const extraHeaders = await prepareProviderExtraHeaderCredentials(provider)
    Object.assign(credentialRefs, extraHeaders.credentialRefs)
    if (
      Object.keys(extraHeaders.credentialRefs).length > 0 ||
      (nextCredentialRef && typeof nextCredentialRef !== 'string')
    ) {
      nextCredentialRef = Object.keys(credentialRefs).length > 0 ? credentialRefs : undefined
    }

    const upsertOptions = {
      ...options,
      ...mergeClearCredentialKinds(options, extraHeaders.clearCredentialKinds)
    }
    if (options.clearCredential === true) {
      upsertOptions.clearCredential = true
    }
    return Object.keys(upsertOptions).length > 0
      ? storageV2ProviderRepository.upsert(extraHeaders.provider, sortOrder, nextCredentialRef, upsertOptions)
      : storageV2ProviderRepository.upsert(extraHeaders.provider, sortOrder, nextCredentialRef)
  }

  async upsertProviderMetadata(provider: Provider, sortOrder?: number) {
    const extraHeaders = await prepareProviderExtraHeaderCredentials(provider)
    const credentialRefs = Object.keys(extraHeaders.credentialRefs).length > 0 ? extraHeaders.credentialRefs : undefined
    return storageV2ProviderRepository.upsert(extraHeaders.provider, sortOrder, credentialRefs, {
      preserveExistingCredential: true,
      preserveModels: true,
      preserveSortOrder: sortOrder === undefined,
      ...mergeClearCredentialKinds({}, extraHeaders.clearCredentialKinds)
    })
  }

  async upsertProviderModels(provider: Provider, models: unknown[], sortOrder?: number) {
    const providerWithModels = { ...(provider as any), models } as Provider
    const extraHeaders = await prepareProviderExtraHeaderCredentials(providerWithModels)
    const credentialRefs = Object.keys(extraHeaders.credentialRefs).length > 0 ? extraHeaders.credentialRefs : undefined
    return storageV2ProviderRepository.upsert(extraHeaders.provider, sortOrder, credentialRefs, {
      preserveExistingCredential: true,
      preserveSortOrder: sortOrder === undefined,
      ...mergeClearCredentialKinds({}, extraHeaders.clearCredentialKinds)
    })
  }

  async upsertProviderApiKeys(providerId: string, apiKeys: ProviderApiKeyEntry[]) {
    const normalizedApiKeys = apiKeys.flatMap((entry) => {
      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const key = typeof entry.key === 'string' ? entry.key.trim() : ''
      if (!id || !key) return []

      return [
        {
          id,
          key,
          ...(typeof entry.label === 'string' && entry.label ? { label: entry.label } : {}),
          isEnabled: entry.isEnabled === true
        }
      ]
    })

    if (normalizedApiKeys.length === 0) {
      return storageV2ProviderRepository.upsertCredentials(providerId, undefined, {
        clearCredentialKinds: ['apiKey', 'apiKeys']
      })
    }

    const apiKeysRef = await storageV2SecretVaultService.setSecret(
      'provider',
      providerId,
      'apiKeys',
      JSON.stringify(normalizedApiKeys)
    )
    const legacyApiKey = selectProviderLegacyApiKey(normalizedApiKeys)
    const apiKeyRef = legacyApiKey
      ? await storageV2SecretVaultService.setSecret('provider', providerId, 'apiKey', legacyApiKey)
      : undefined

    return storageV2ProviderRepository.upsertCredentials(
      providerId,
      {
        apiKeys: apiKeysRef,
        ...(apiKeyRef ? { apiKey: apiKeyRef } : {})
      },
      apiKeyRef ? undefined : { clearCredentialKinds: ['apiKey'] }
    )
  }

  async upsertProviderAuthConfig(providerId: string, authConfig: AuthConfig | null | undefined) {
    const normalizedAuthConfig = normalizeProviderAuthConfig(authConfig)
    if (!normalizedAuthConfig) {
      return storageV2ProviderRepository.upsertCredentials(providerId, undefined, {
        clearCredentialKinds: ['authConfig']
      })
    }

    const authConfigRef = await storageV2SecretVaultService.setSecret(
      'provider',
      providerId,
      'authConfig',
      JSON.stringify(normalizedAuthConfig)
    )

    return storageV2ProviderRepository.upsertCredentials(providerId, {
      authConfig: authConfigRef
    })
  }

  async deleteProvider(providerId: string) {
    return storageV2ProviderRepository.delete(providerId)
  }

  async listAssistants(options?: StorageV2ListOptions) {
    return storageV2AssistantRepository.list(options)
  }

  async upsertAssistant(assistant: Assistant, sortOrder?: number) {
    return storageV2AssistantRepository.upsert(assistant, sortOrder)
  }

  async deleteAssistant(assistantId: string) {
    return storageV2AssistantRepository.delete(assistantId)
  }

  async listConversations(filter?: { ownerType?: string; ownerId?: string } & StorageV2ListOptions) {
    return storageV2ConversationRepository.list(filter)
  }

  async listMessages(conversationId: string, options?: { limit?: number; offset?: number }) {
    return storageV2ConversationRepository.listMessages(conversationId, options)
  }

  async syncConversation(conversation: StorageV2ConversationImport, options?: StorageV2ConversationImportOptions) {
    return storageV2ConversationRepository.importConversation(conversation, options)
  }

  async upsertConversation(conversation: StorageV2ConversationUpsert, options?: StorageV2ConversationUpsertOptions) {
    return storageV2ConversationRepository.upsertConversation(conversation, options)
  }

  async upsertMessage(conversationId: string, message: Record<string, any>) {
    return storageV2ConversationRepository.upsertMessage(conversationId, message)
  }

  async upsertMessageBlocks(
    messageId: string,
    blocks: Array<Record<string, any>>,
    options?: StorageV2MessageBlocksUpsertOptions
  ) {
    return storageV2ConversationRepository.upsertMessageBlocks(messageId, blocks, options)
  }

  async deleteConversation(conversationId: string) {
    return storageV2ConversationRepository.delete(conversationId)
  }

  async listFiles(options?: StorageV2ListOptions) {
    return storageV2FileRepository.list(options)
  }

  async getFile(fileId: string) {
    return storageV2FileRepository.get(fileId)
  }

  async projectFilesToLegacyRuntime() {
    return storageV2FileLegacyProjectionService.projectToLegacyRuntime()
  }

  async upsertFile(file: Record<string, any>) {
    return storageV2FileRepository.importFile(file)
  }

  async deleteFile(fileId: string) {
    return storageV2FileRepository.delete(fileId)
  }

  async importLegacyReduxSnapshot(snapshot: unknown, options?: StorageV2LegacyImportOptions) {
    return storageV2LegacyReduxImportService.importSnapshot(snapshot as any, options)
  }

  async importLegacyDexieSnapshot(snapshot: unknown, options?: StorageV2LegacyDexieImportOptions) {
    return storageV2LegacyDexieImportService.importSnapshot(snapshot as any, options)
  }

  async importLegacyAgentDb(options?: { dryRun?: boolean; dbPath?: string; createSnapshot?: boolean }) {
    return storageV2LegacyAgentDbImportService.importSnapshot(options)
  }

  async importLegacyAppDb(options?: { dryRun?: boolean; dbPath?: string; createSnapshot?: boolean }) {
    return storageV2LegacyAppDbImportService.importSnapshot(options)
  }
}

export const storageV2Service = new StorageV2Service()
