import type { Provider } from '@main/data/migration/v2/legacyTypes'
import {
  RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
  serializeRendererPersistCacheValue
} from '@shared/data/cache/cacheSchemas'
import {
  STORAGE_V2_DURABLE_LOCAL_STORAGE_KEYS,
  STORAGE_V2_MCP_PROVIDER_TOKEN_KEYS
} from '@shared/data/storage/localStorageKeys'
import type { Assistant } from '@shared/data/types/assistant'

import { isSensitiveHeaderName } from './SecretFieldDetection'
import { storageV2SecretVaultService } from './SecretVaultService'
import { getStorageV2FlatSettingsSecretField } from './SettingsSecretFields'
import {
  storageV2AssistantRepository,
  storageV2KnowledgeRepository,
  storageV2ProviderRepository,
  storageV2SettingsRepository
} from './StorageV2Repositories'

type LegacyReduxSnapshot = {
  settings?: Record<string, unknown> | string
  llm?:
    | {
        providers?: Provider[]
        defaultModel?: unknown
        topicNamingModel?: unknown
        quickModel?: unknown
        translateModel?: unknown
        quickAssistantId?: unknown
        settings?: unknown
      }
    | string
  assistants?:
    | {
        defaultAssistant?: Assistant
        assistants?: Assistant[]
        tagsOrder?: unknown
        collapsedTags?: unknown
        presets?: unknown
        unifiedListOrder?: unknown
      }
    | string
  redux?:
    | {
        backup?: unknown
        codeTools?: unknown
        copilot?: unknown
        inputTools?: unknown
        knowledge?: unknown
        memory?: unknown
        minApps?: unknown
        mcp?: unknown
        note?: unknown
        nutstore?: unknown
        ocr?: unknown
        openclaw?: unknown
        paintings?: unknown
        preprocess?: unknown
        selectionStore?: unknown
        shortcuts?: unknown
        translate?: unknown
        websearch?: unknown
      }
    | string
  localStorage?:
    | {
        clearedMcpProviderTokenKeys?: unknown
        durableValues?: unknown
        mcpProviderTokenClearMode?: unknown
        mcpProviderTokens?: unknown
      }
    | string
}

type SecretField = {
  path: string[]
  kind: string
}

const MCP_PROVIDER_TOKEN_KEYS = new Set<string>(STORAGE_V2_MCP_PROVIDER_TOKEN_KEYS)
const DURABLE_LOCAL_STORAGE_KEYS = new Set<string>(STORAGE_V2_DURABLE_LOCAL_STORAGE_KEYS)

export type StorageV2LegacyImportOptions = {
  dryRun?: boolean
  pruneMissing?: boolean
  protectExistingFromDefaults?: boolean
}

export type StorageV2LegacyImportReport = {
  dryRun: boolean
  settingsCount: number
  providerCount: number
  modelCount: number
  assistantCount: number
  deletedProviderCount: number
  deletedAssistantCount: number
  knowledgeBaseCount: number
  knowledgeItemCount: number
  importedKnowledgeBaseCount: number
  importedKnowledgeItemCount: number
  deletedKnowledgeBaseCount: number
  deletedKnowledgeItemCount: number
  secretCandidateCount: number
  importedSecretCount: number
  skippedSecretCount: number
  warnings: string[]
}

const STARTUP_DEFAULT_PROTECTED_SETTINGS = new Map<string, unknown[]>([
  ['settings.webdavHost', ['']],
  ['settings.webdavUser', ['']],
  ['settings.webdavPass', ['']],
  ['settings.webdavPath', ['', '/cherry-studio', '/cherry-studio-pi']],
  ['settings.webdavAutoSync', [false]],
  ['settings.webdavSyncInterval', [0, '0', '']],
  ['settings.dataSyncWebdavHost', ['']],
  ['settings.dataSyncWebdavUser', ['']],
  ['settings.dataSyncWebdavPass', ['']],
  ['settings.dataSyncWebdavPath', ['', '/cherry-studio-pi']],
  ['settings.dataSyncAutoSync', [false]],
  ['settings.dataSyncSyncInterval', [0, '0', '']]
])

function parseMaybeJson<T>(value: T | string | undefined): T | undefined {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function normalizeSnapshot(input: LegacyReduxSnapshot | string): LegacyReduxSnapshot {
  const snapshot = parseMaybeJson<LegacyReduxSnapshot>(input) ?? {}
  return {
    settings: parseMaybeJson<Record<string, unknown>>(snapshot.settings),
    llm: parseMaybeJson<Exclude<LegacyReduxSnapshot['llm'], string>>(snapshot.llm),
    assistants: parseMaybeJson<Exclude<LegacyReduxSnapshot['assistants'], string>>(snapshot.assistants),
    redux: parseMaybeJson<Exclude<LegacyReduxSnapshot['redux'], string>>(snapshot.redux),
    localStorage: parseMaybeJson<Exclude<LegacyReduxSnapshot['localStorage'], string>>(snapshot.localStorage)
  }
}

function mergeProviderModels(left: Provider['models'] = [], right: Provider['models'] = []): Provider['models'] {
  const modelsById = new Map<string, Provider['models'][number]>()

  for (const model of [...left, ...right]) {
    if (!model?.id) continue
    modelsById.set(model.id, model)
  }

  return Array.from(modelsById.values())
}

function normalizeProviders(providers: Provider[]): Provider[] {
  const providersById = new Map<string, Provider>()

  for (const provider of providers) {
    if (!provider?.id) continue

    const existing = providersById.get(provider.id)
    if (!existing) {
      providersById.set(provider.id, {
        ...provider,
        models: mergeProviderModels([], provider.models)
      })
      continue
    }

    providersById.set(provider.id, {
      ...existing,
      ...provider,
      models: mergeProviderModels(existing.models, provider.models)
    })
  }

  return Array.from(providersById.values())
}

const LLM_SETTINGS_SECRET_FIELDS: SecretField[] = [
  {
    path: ['vertexai', 'serviceAccount', 'privateKey'],
    kind: 'vertexai.serviceAccount.privateKey'
  },
  {
    path: ['awsBedrock', 'secretAccessKey'],
    kind: 'awsBedrock.secretAccessKey'
  },
  {
    path: ['awsBedrock', 'apiKey'],
    kind: 'awsBedrock.apiKey'
  },
  {
    path: ['cherryIn', 'accessToken'],
    kind: 'cherryIn.accessToken'
  },
  {
    path: ['cherryIn', 'refreshToken'],
    kind: 'cherryIn.refreshToken'
  }
]

function cloneJsonObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {}
  return JSON.parse(JSON.stringify(value)) as Record<string, any>
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableStringify(value: unknown) {
  return JSON.stringify(value)
}

function isMeaningfulStoredSettingValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'boolean') return value === true
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(isMeaningfulStoredSettingValue)
  }

  return true
}

function isStartupDefaultProtectedValue(key: string, value: unknown): boolean {
  return (STARTUP_DEFAULT_PROTECTED_SETTINGS.get(key) ?? []).some(
    (defaultValue) => stableStringify(defaultValue) === stableStringify(value)
  )
}

async function filterStartupDefaultProtectedSettings(
  settingsEntries: Array<[string, unknown, string]>,
  options: {
    protectExistingFromDefaults: boolean
    warnings: string[]
  }
) {
  if (!options.protectExistingFromDefaults) return settingsEntries

  const filteredEntries: Array<[string, unknown, string]> = []

  for (const entry of settingsEntries) {
    const [key, value] = entry
    if (!isStartupDefaultProtectedValue(key, value)) {
      filteredEntries.push(entry)
      continue
    }

    const existingValue = await storageV2SettingsRepository.get(key)
    if (isMeaningfulStoredSettingValue(existingValue) && stableStringify(existingValue) !== stableStringify(value)) {
      options.warnings.push(`Skipped startup default overwrite for ${key}.`)
      continue
    }

    filteredEntries.push(entry)
  }

  return filteredEntries
}

function getNestedValue(root: Record<string, any>, path: string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setNestedValue(root: Record<string, any>, path: string[], value: unknown) {
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') {
      current[segment] = {}
    }
    current = current[segment]
  }
  current[path[path.length - 1]] = value
}

function deleteNestedValue(root: Record<string, any>, path: string[]) {
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') {
      return
    }
    current = current[segment]
  }
  delete current[path[path.length - 1]]
}

function stripAssistantRuntimeData<T extends { topics?: unknown }>(assistant: T): T & { topics: [] } {
  return {
    ...assistant,
    topics: []
  }
}

function sanitizeAssistantSetting(key: string, value: unknown) {
  if (key === 'defaultAssistant' && value && typeof value === 'object') {
    return stripAssistantRuntimeData(value as Record<string, unknown>)
  }

  if (key === 'presets' && Array.isArray(value)) {
    return value.map((preset) =>
      preset && typeof preset === 'object' ? stripAssistantRuntimeData(preset as Record<string, unknown>) : preset
    )
  }

  return value
}

async function sanitizeLlmSettings(
  value: unknown,
  options: {
    dryRun: boolean
    canImportSecrets: boolean
    warnings: string[]
  }
): Promise<{
  value: unknown
  secretCandidateCount: number
  importedSecretCount: number
}> {
  const sanitized = cloneJsonObject(value)
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const field of LLM_SETTINGS_SECRET_FIELDS) {
    const secretValue = getNestedValue(sanitized, field.path)
    if (typeof secretValue !== 'string' || !secretValue) continue

    secretCandidateCount++

    if (!options.dryRun && options.canImportSecrets) {
      const secretRef = await storageV2SecretVaultService.setSecret('llm-settings', 'default', field.kind, secretValue)
      setNestedValue(sanitized, [...field.path.slice(0, -1), `${field.path.at(-1)}SecretRef`], secretRef)
      importedSecretCount++
    } else if (!options.dryRun) {
      setNestedValue(sanitized, [...field.path.slice(0, -1), `${field.path.at(-1)}SecretUnavailable`], true)
    }

    if (!options.dryRun) {
      deleteNestedValue(sanitized, field.path)
    }
  }

  if (secretCandidateCount > 0 && options.dryRun) {
    options.warnings.push(
      'Sensitive LLM settings were detected. Dry run did not write them to the Storage v2 secret vault.'
    )
  } else if (secretCandidateCount > 0 && !options.canImportSecrets) {
    options.warnings.push('Sensitive LLM settings were detected but local secret vault is unavailable.')
  }

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeMcpState(
  value: unknown,
  options: {
    dryRun: boolean
    canImportSecrets: boolean
    warnings: string[]
  }
): Promise<{
  value: unknown
  secretCandidateCount: number
  importedSecretCount: number
}> {
  const sanitized = cloneJsonObject(value)
  const servers = Array.isArray(sanitized.servers) ? sanitized.servers : []
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [index, server] of servers.entries()) {
    if (!isRecord(server.env)) continue

    const serverId =
      typeof server.id === 'string' && server.id
        ? server.id
        : typeof server.name === 'string' && server.name
          ? server.name
          : `server-${index}`
    const envSecretRefs = isRecord(server.envSecretRefs) ? { ...server.envSecretRefs } : {}
    const envSecretUnavailable = isRecord(server.envSecretUnavailable) ? { ...server.envSecretUnavailable } : {}

    for (const [key, item] of Object.entries(server.env)) {
      if (typeof item !== 'string' || !item) continue

      secretCandidateCount++

      if (!options.dryRun && options.canImportSecrets) {
        envSecretRefs[key] = await storageV2SecretVaultService.setSecret('mcp-server', serverId, `env.${key}`, item)
        importedSecretCount++
      } else if (!options.dryRun) {
        envSecretUnavailable[key] = true
      }

      if (!options.dryRun) {
        delete server.env[key]
      }
    }

    if (!options.dryRun) {
      if (Object.keys(envSecretRefs).length > 0) {
        server.envSecretRefs = envSecretRefs
      }
      if (Object.keys(envSecretUnavailable).length > 0) {
        server.envSecretUnavailable = envSecretUnavailable
      }
      if (Object.keys(server.env).length === 0) {
        delete server.env
      }
    }
  }

  if (secretCandidateCount > 0 && options.dryRun) {
    options.warnings.push(
      'MCP server environment values were detected. Dry run did not write them to the secret vault.'
    )
  } else if (secretCandidateCount > 0 && !options.canImportSecrets) {
    options.warnings.push('MCP server environment values were detected but local secret vault is unavailable.')
  }

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeMcpProviderTokens(
  value: unknown,
  options: {
    dryRun: boolean
    canImportSecrets: boolean
    warnings: string[]
  }
): Promise<{
  value: unknown
  secretCandidateCount: number
  importedSecretCount: number
}> {
  const sanitized = cloneJsonObject(value)
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [tokenKey, token] of Object.entries(sanitized)) {
    if (!MCP_PROVIDER_TOKEN_KEYS.has(tokenKey) || typeof token !== 'string' || !token) {
      delete sanitized[tokenKey]
      continue
    }

    secretCandidateCount++

    if (!options.dryRun && options.canImportSecrets) {
      sanitized[tokenKey] = {
        tokenSecretRef: await storageV2SecretVaultService.setSecret('mcp-provider-token', tokenKey, 'token', token)
      }
      importedSecretCount++
    } else if (!options.dryRun) {
      sanitized[tokenKey] = {
        tokenSecretUnavailable: true
      }
    }
  }

  if (secretCandidateCount > 0 && options.dryRun) {
    options.warnings.push('MCP provider tokens were detected. Dry run did not write them to the secret vault.')
  } else if (secretCandidateCount > 0 && !options.canImportSecrets) {
    options.warnings.push('MCP provider tokens were detected but local secret vault is unavailable.')
  }

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

function sanitizeDurableLocalStorageValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const durableValues: Record<string, string> = {}

  for (const [key, item] of Object.entries(value)) {
    if (!DURABLE_LOCAL_STORAGE_KEYS.has(key)) continue

    if (key === RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY) {
      const sanitizedPersistCache = serializeRendererPersistCacheValue(item)
      if (sanitizedPersistCache) {
        durableValues[key] = sanitizedPersistCache
      }
      continue
    }

    if (typeof item === 'string' && item) {
      durableValues[key] = item
    }
  }

  return durableValues
}

function sanitizeClearedMcpProviderTokenKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string' && MCP_PROVIDER_TOKEN_KEYS.has(item)))
  )
}

function sanitizeMcpProviderTokenClearMode(value: unknown): 'explicit' | null {
  return value === 'explicit' ? 'explicit' : null
}

type SecretSanitizerOptions = {
  dryRun: boolean
  canImportSecrets: boolean
  warnings: string[]
}

type SecretSanitizerResult = {
  value: unknown
  secretCandidateCount: number
  importedSecretCount: number
}

async function moveStringSecretField(
  owner: Record<string, any>,
  options: SecretSanitizerOptions & {
    scope: string
    ownerId: string
    field: string
    kind: string
  }
): Promise<{
  detected: boolean
  imported: boolean
}> {
  const secretValue = owner[options.field]
  if (typeof secretValue !== 'string' || !secretValue) {
    return {
      detected: false,
      imported: false
    }
  }

  let imported = false

  if (!options.dryRun && options.canImportSecrets) {
    owner[`${options.field}SecretRef`] = await storageV2SecretVaultService.setSecret(
      options.scope,
      options.ownerId,
      options.kind,
      secretValue
    )
    imported = true
  } else if (!options.dryRun) {
    owner[`${options.field}SecretUnavailable`] = true
  }

  if (!options.dryRun) {
    delete owner[options.field]
  }

  return {
    detected: true,
    imported
  }
}

function pushSecretWarning(
  options: SecretSanitizerOptions,
  secretCandidateCount: number,
  dryRunMessage: string,
  unavailableMessage: string
) {
  if (secretCandidateCount > 0 && options.dryRun) {
    options.warnings.push(dryRunMessage)
  } else if (secretCandidateCount > 0 && !options.canImportSecrets) {
    options.warnings.push(unavailableMessage)
  }
}

async function sanitizeKnowledgeState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const bases = Array.isArray(sanitized.bases) ? sanitized.bases : []
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [index, base] of bases.entries()) {
    if (!isRecord(base)) continue

    const provider = base.preprocessProvider?.provider
    if (!isRecord(provider)) continue

    const ownerId = typeof base.id === 'string' && base.id ? base.id : `knowledge-base-${index}`
    const result = await moveStringSecretField(provider, {
      ...options,
      scope: 'knowledge-base',
      ownerId,
      field: 'apiKey',
      kind: 'preprocessProvider.apiKey'
    })

    if (result.detected) secretCandidateCount++
    if (result.imported) importedSecretCount++
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Knowledge base preprocess provider API keys were detected. Dry run did not write them to the secret vault.',
    'Knowledge base preprocess provider API keys were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizePreprocessState(
  value: unknown,
  options: SecretSanitizerOptions
): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const providers = Array.isArray(sanitized.providers) ? sanitized.providers : []
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [index, provider] of providers.entries()) {
    if (!isRecord(provider)) continue

    const ownerId = typeof provider.id === 'string' && provider.id ? provider.id : `preprocess-provider-${index}`
    const result = await moveStringSecretField(provider, {
      ...options,
      scope: 'preprocess-provider',
      ownerId,
      field: 'apiKey',
      kind: 'apiKey'
    })

    if (result.detected) secretCandidateCount++
    if (result.imported) importedSecretCount++
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Document preprocess provider API keys were detected. Dry run did not write them to the secret vault.',
    'Document preprocess provider API keys were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeWebSearchState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const providers = Array.isArray(sanitized.providers) ? sanitized.providers : []
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [index, provider] of providers.entries()) {
    if (!isRecord(provider)) continue

    const ownerId = typeof provider.id === 'string' && provider.id ? provider.id : `websearch-provider-${index}`
    for (const field of ['apiKey', 'basicAuthPassword']) {
      const result = await moveStringSecretField(provider, {
        ...options,
        scope: 'websearch-provider',
        ownerId,
        field,
        kind: field
      })

      if (result.detected) secretCandidateCount++
      if (result.imported) importedSecretCount++
    }
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Web search provider credentials were detected. Dry run did not write them to the secret vault.',
    'Web search provider credentials were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeOcrState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const providers = Array.isArray(sanitized.providers) ? sanitized.providers : []
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [index, provider] of providers.entries()) {
    if (!isRecord(provider)) continue

    const apiConfig = provider.config?.api
    if (!isRecord(apiConfig)) continue

    const ownerId = typeof provider.id === 'string' && provider.id ? provider.id : `ocr-provider-${index}`
    const result = await moveStringSecretField(apiConfig, {
      ...options,
      scope: 'ocr-provider',
      ownerId,
      field: 'apiKey',
      kind: 'api.apiKey'
    })

    if (result.detected) secretCandidateCount++
    if (result.imported) importedSecretCount++
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'OCR provider API keys were detected. Dry run did not write them to the secret vault.',
    'OCR provider API keys were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeNutstoreState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  let secretCandidateCount = 0
  let importedSecretCount = 0

  const result = await moveStringSecretField(sanitized, {
    ...options,
    scope: 'nutstore',
    ownerId: 'default',
    field: 'nutstoreToken',
    kind: 'token'
  })

  if (result.detected) secretCandidateCount++
  if (result.imported) importedSecretCount++

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Nutstore sync tokens were detected. Dry run did not write them to the secret vault.',
    'Nutstore sync tokens were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeCodeToolsState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const environmentVariables = isRecord(sanitized.environmentVariables) ? sanitized.environmentVariables : {}
  const environmentVariableSecretRefs = isRecord(sanitized.environmentVariableSecretRefs)
    ? { ...sanitized.environmentVariableSecretRefs }
    : {}
  const environmentVariableSecretUnavailable = isRecord(sanitized.environmentVariableSecretUnavailable)
    ? { ...sanitized.environmentVariableSecretUnavailable }
    : {}
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [toolId, item] of Object.entries(environmentVariables)) {
    if (typeof item !== 'string' || !item) continue

    secretCandidateCount++

    if (!options.dryRun && options.canImportSecrets) {
      environmentVariableSecretRefs[toolId] = await storageV2SecretVaultService.setSecret(
        'code-tools',
        toolId,
        'environmentVariables',
        item
      )
      importedSecretCount++
    } else if (!options.dryRun) {
      environmentVariableSecretUnavailable[toolId] = true
    }

    if (!options.dryRun) {
      environmentVariables[toolId] = ''
    }
  }

  if (!options.dryRun) {
    if (Object.keys(environmentVariableSecretRefs).length > 0) {
      sanitized.environmentVariableSecretRefs = environmentVariableSecretRefs
    }
    if (Object.keys(environmentVariableSecretUnavailable).length > 0) {
      sanitized.environmentVariableSecretUnavailable = environmentVariableSecretUnavailable
    }
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Code tool environment variables were detected. Dry run did not write them to the secret vault.',
    'Code tool environment variables were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeCopilotState(value: unknown, options: SecretSanitizerOptions): Promise<SecretSanitizerResult> {
  const sanitized = cloneJsonObject(value)
  const defaultHeaders = isRecord(sanitized.defaultHeaders) ? sanitized.defaultHeaders : {}
  const defaultHeaderSecretRefs = isRecord(sanitized.defaultHeaderSecretRefs)
    ? { ...sanitized.defaultHeaderSecretRefs }
    : {}
  const defaultHeaderSecretUnavailable = isRecord(sanitized.defaultHeaderSecretUnavailable)
    ? { ...sanitized.defaultHeaderSecretUnavailable }
    : {}
  let secretCandidateCount = 0
  let importedSecretCount = 0

  for (const [headerName, headerValue] of Object.entries(defaultHeaders)) {
    if (typeof headerValue !== 'string' || !headerValue || !isSensitiveHeaderName(headerName)) continue

    secretCandidateCount++

    if (!options.dryRun && options.canImportSecrets) {
      defaultHeaderSecretRefs[headerName] = await storageV2SecretVaultService.setSecret(
        'copilot',
        'defaultHeaders',
        headerName,
        headerValue
      )
      importedSecretCount++
    } else if (!options.dryRun) {
      defaultHeaderSecretUnavailable[headerName] = true
    }

    if (!options.dryRun) {
      delete defaultHeaders[headerName]
    }
  }

  if (!options.dryRun) {
    if (Object.keys(defaultHeaderSecretRefs).length > 0) {
      sanitized.defaultHeaderSecretRefs = defaultHeaderSecretRefs
    }
    if (Object.keys(defaultHeaderSecretUnavailable).length > 0) {
      sanitized.defaultHeaderSecretUnavailable = defaultHeaderSecretUnavailable
    }
  }

  pushSecretWarning(
    options,
    secretCandidateCount,
    'GitHub Copilot custom headers with sensitive names were detected. Dry run did not write them to the secret vault.',
    'GitHub Copilot custom headers with sensitive names were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

async function sanitizeSettingsEntry(
  key: string,
  value: unknown,
  options: SecretSanitizerOptions
): Promise<SecretSanitizerResult> {
  const flatSecretField = getStorageV2FlatSettingsSecretField(key)
  if (flatSecretField) {
    const secretValue = typeof value === 'string' ? value : null
    if (!secretValue) {
      return {
        value,
        secretCandidateCount: 0,
        importedSecretCount: 0
      }
    }

    let sanitizedValue: unknown = value
    let importedSecretCount = 0

    if (!options.dryRun && options.canImportSecrets) {
      sanitizedValue = {
        secretRef: await storageV2SecretVaultService.setSecret(
          'settings',
          flatSecretField.key,
          flatSecretField.kind,
          secretValue
        )
      }
      importedSecretCount = 1
    } else if (!options.dryRun) {
      sanitizedValue = {
        secretUnavailable: true
      }
    }

    pushSecretWarning(
      options,
      1,
      'Sensitive app settings were detected. Dry run did not write them to the secret vault.',
      'Sensitive app settings were detected but local secret vault is unavailable.'
    )

    return {
      value: options.dryRun ? value : sanitizedValue,
      secretCandidateCount: 1,
      importedSecretCount
    }
  }

  if (key !== 's3' && key !== 'apiServer') {
    return {
      value,
      secretCandidateCount: 0,
      importedSecretCount: 0
    }
  }

  const sanitized = cloneJsonObject(value)
  let secretCandidateCount = 0
  let importedSecretCount = 0
  const result =
    key === 's3'
      ? await moveStringSecretField(sanitized, {
          ...options,
          scope: 'settings',
          ownerId: 's3',
          field: 'secretAccessKey',
          kind: 'secretAccessKey'
        })
      : await moveStringSecretField(sanitized, {
          ...options,
          scope: 'settings',
          ownerId: 'apiServer',
          field: 'apiKey',
          kind: 'apiKey'
        })

  if (result.detected) secretCandidateCount++
  if (result.imported) importedSecretCount++

  pushSecretWarning(
    options,
    secretCandidateCount,
    'Sensitive app settings were detected. Dry run did not write them to the secret vault.',
    'Sensitive app settings were detected but local secret vault is unavailable.'
  )

  return {
    value: options.dryRun ? value : sanitized,
    secretCandidateCount,
    importedSecretCount
  }
}

export class StorageV2LegacyReduxImportService {
  async importSnapshot(
    input: LegacyReduxSnapshot | string,
    options: StorageV2LegacyImportOptions = {}
  ): Promise<StorageV2LegacyImportReport> {
    const dryRun = options.dryRun !== false
    const pruneMissing = options.pruneMissing !== false
    const protectExistingFromDefaults = options.protectExistingFromDefaults === true
    const snapshot = normalizeSnapshot(input)
    const warnings: string[] = []

    const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {}
    const llm = snapshot.llm && typeof snapshot.llm === 'object' ? snapshot.llm : {}
    const assistants = snapshot.assistants && typeof snapshot.assistants === 'object' ? snapshot.assistants : {}
    const redux = snapshot.redux && typeof snapshot.redux === 'object' ? snapshot.redux : {}
    const localStorage = snapshot.localStorage && typeof snapshot.localStorage === 'object' ? snapshot.localStorage : {}
    const hasProviderList = Array.isArray(llm.providers)
    const hasAssistantList = Array.isArray(assistants.assistants)
    const providers = hasProviderList ? normalizeProviders(llm.providers!) : []
    const assistantList = hasAssistantList ? assistants.assistants! : []
    const canImportSecrets = storageV2SecretVaultService.isAvailable()
    const settingsEntries: Array<[string, unknown, string]> = []
    let settingsSecretCandidateCount = 0
    let settingsImportedSecretCount = 0
    let llmSettingsSecretCandidateCount = 0
    let llmSettingsImportedSecretCount = 0
    let reduxSecretCandidateCount = 0
    let reduxImportedSecretCount = 0

    for (const [key, value] of Object.entries(settings)) {
      const sanitizedSettingsEntry = await sanitizeSettingsEntry(key, value, {
        dryRun,
        canImportSecrets,
        warnings
      })
      settingsEntries.push([`settings.${key}`, sanitizedSettingsEntry.value, 'settings'])
      settingsSecretCandidateCount += sanitizedSettingsEntry.secretCandidateCount
      settingsImportedSecretCount += sanitizedSettingsEntry.importedSecretCount
    }

    for (const key of ['defaultModel', 'topicNamingModel', 'quickModel', 'translateModel', 'quickAssistantId']) {
      if (Object.hasOwn(llm, key)) {
        settingsEntries.push([`llm.${key}`, (llm as Record<string, unknown>)[key], 'llm'])
      }
    }

    if (Object.hasOwn(llm, 'settings')) {
      const sanitizedLlmSettings = await sanitizeLlmSettings((llm as Record<string, unknown>).settings, {
        dryRun,
        canImportSecrets,
        warnings
      })
      settingsEntries.push(['llm.settings', sanitizedLlmSettings.value, 'llm'])
      llmSettingsSecretCandidateCount = sanitizedLlmSettings.secretCandidateCount
      llmSettingsImportedSecretCount = sanitizedLlmSettings.importedSecretCount
    }

    for (const key of ['tagsOrder', 'collapsedTags', 'presets', 'unifiedListOrder', 'defaultAssistant']) {
      if (Object.hasOwn(assistants, key)) {
        settingsEntries.push([
          `assistants.${key}`,
          sanitizeAssistantSetting(key, (assistants as Record<string, unknown>)[key]),
          'assistants'
        ])
      }
    }

    for (const key of [
      'backup',
      'codeTools',
      'copilot',
      'inputTools',
      'knowledge',
      'memory',
      'minApps',
      'mcp',
      'note',
      'nutstore',
      'ocr',
      'openclaw',
      'paintings',
      'preprocess',
      'selectionStore',
      'shortcuts',
      'translate',
      'websearch'
    ]) {
      if (Object.hasOwn(redux, key)) {
        let value = (redux as Record<string, unknown>)[key]

        if (key === 'codeTools') {
          const sanitizedCodeToolsState = await sanitizeCodeToolsState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedCodeToolsState.value
          reduxSecretCandidateCount += sanitizedCodeToolsState.secretCandidateCount
          reduxImportedSecretCount += sanitizedCodeToolsState.importedSecretCount
        } else if (key === 'copilot') {
          const sanitizedCopilotState = await sanitizeCopilotState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedCopilotState.value
          reduxSecretCandidateCount += sanitizedCopilotState.secretCandidateCount
          reduxImportedSecretCount += sanitizedCopilotState.importedSecretCount
        } else if (key === 'knowledge') {
          const sanitizedKnowledgeState = await sanitizeKnowledgeState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedKnowledgeState.value
          reduxSecretCandidateCount += sanitizedKnowledgeState.secretCandidateCount
          reduxImportedSecretCount += sanitizedKnowledgeState.importedSecretCount
        } else if (key === 'mcp') {
          const sanitizedMcpState = await sanitizeMcpState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedMcpState.value
          reduxSecretCandidateCount += sanitizedMcpState.secretCandidateCount
          reduxImportedSecretCount += sanitizedMcpState.importedSecretCount
        } else if (key === 'nutstore') {
          const sanitizedNutstoreState = await sanitizeNutstoreState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedNutstoreState.value
          reduxSecretCandidateCount += sanitizedNutstoreState.secretCandidateCount
          reduxImportedSecretCount += sanitizedNutstoreState.importedSecretCount
        } else if (key === 'ocr') {
          const sanitizedOcrState = await sanitizeOcrState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedOcrState.value
          reduxSecretCandidateCount += sanitizedOcrState.secretCandidateCount
          reduxImportedSecretCount += sanitizedOcrState.importedSecretCount
        } else if (key === 'preprocess') {
          const sanitizedPreprocessState = await sanitizePreprocessState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedPreprocessState.value
          reduxSecretCandidateCount += sanitizedPreprocessState.secretCandidateCount
          reduxImportedSecretCount += sanitizedPreprocessState.importedSecretCount
        } else if (key === 'websearch') {
          const sanitizedWebSearchState = await sanitizeWebSearchState(value, {
            dryRun,
            canImportSecrets,
            warnings
          })
          value = sanitizedWebSearchState.value
          reduxSecretCandidateCount += sanitizedWebSearchState.secretCandidateCount
          reduxImportedSecretCount += sanitizedWebSearchState.importedSecretCount
        }

        settingsEntries.push([`redux.${key}`, value, 'redux'])
      }
    }

    if (Object.hasOwn(localStorage, 'mcpProviderTokens')) {
      const sanitizedMcpProviderTokens = await sanitizeMcpProviderTokens(
        (localStorage as Record<string, unknown>).mcpProviderTokens,
        {
          dryRun,
          canImportSecrets,
          warnings
        }
      )
      settingsEntries.push(['localStorage.mcpProviderTokens', sanitizedMcpProviderTokens.value, 'localStorage'])
      reduxSecretCandidateCount += sanitizedMcpProviderTokens.secretCandidateCount
      reduxImportedSecretCount += sanitizedMcpProviderTokens.importedSecretCount
    }

    if (Object.hasOwn(localStorage, 'durableValues')) {
      settingsEntries.push([
        'localStorage.durableValues',
        sanitizeDurableLocalStorageValues((localStorage as Record<string, unknown>).durableValues),
        'localStorage'
      ])
    }

    if (Object.hasOwn(localStorage, 'clearedMcpProviderTokenKeys')) {
      settingsEntries.push([
        'localStorage.clearedMcpProviderTokenKeys',
        sanitizeClearedMcpProviderTokenKeys((localStorage as Record<string, unknown>).clearedMcpProviderTokenKeys),
        'localStorage'
      ])
    }

    if (Object.hasOwn(localStorage, 'mcpProviderTokenClearMode')) {
      const clearMode = sanitizeMcpProviderTokenClearMode(
        (localStorage as Record<string, unknown>).mcpProviderTokenClearMode
      )
      if (clearMode) {
        settingsEntries.push(['localStorage.mcpProviderTokenClearMode', clearMode, 'localStorage'])
      }
    }

    const providerSecretCandidateCount = providers.filter((provider) => Boolean(provider.apiKey)).length
    const secretCandidateCount =
      providerSecretCandidateCount +
      settingsSecretCandidateCount +
      llmSettingsSecretCandidateCount +
      reduxSecretCandidateCount
    const modelCount = providers.reduce((count, provider) => count + (provider.models?.length ?? 0), 0)
    let importedSecretCount = settingsImportedSecretCount + llmSettingsImportedSecretCount + reduxImportedSecretCount
    let deletedProviderCount = 0
    let deletedAssistantCount = 0
    let knowledgeBaseCount = 0
    let knowledgeItemCount = 0
    let importedKnowledgeBaseCount = 0
    let importedKnowledgeItemCount = 0
    let deletedKnowledgeBaseCount = 0
    let deletedKnowledgeItemCount = 0
    const knowledgeSettingValue = settingsEntries.find(([key]) => key === 'redux.knowledge')?.[1]
    const knowledgeBases =
      isRecord(knowledgeSettingValue) && Array.isArray(knowledgeSettingValue.bases)
        ? (knowledgeSettingValue.bases as Array<Record<string, any>>)
        : []
    knowledgeBaseCount = knowledgeBases.length
    knowledgeItemCount = knowledgeBases.reduce(
      (count, base) => count + (Array.isArray(base.items) ? base.items.length : 0),
      0
    )

    if (providerSecretCandidateCount > 0 && dryRun) {
      warnings.push('Provider API keys were detected. Dry run did not write them to the Storage v2 secret vault.')
    } else if (providerSecretCandidateCount > 0 && !canImportSecrets) {
      warnings.push('Provider API keys were detected but local secret vault is unavailable.')
    }

    if (!dryRun) {
      const writeableSettingsEntries = await filterStartupDefaultProtectedSettings(settingsEntries, {
        protectExistingFromDefaults,
        warnings
      })

      for (const [key, value, scope] of writeableSettingsEntries) {
        await storageV2SettingsRepository.set(key, value, scope)
      }

      for (const [index, provider] of providers.entries()) {
        const credentialRef =
          provider.apiKey && canImportSecrets
            ? await storageV2SecretVaultService.setSecret('provider', provider.id, 'apiKey', provider.apiKey)
            : undefined
        if (credentialRef) importedSecretCount++
        await storageV2ProviderRepository.upsert(provider, index, credentialRef, { preserveExistingCredential: true })
      }

      for (const [index, assistant] of assistantList.entries()) {
        await storageV2AssistantRepository.upsert(assistant, index)
      }

      if (Object.hasOwn(redux, 'knowledge')) {
        const knowledgeImportReport = await storageV2KnowledgeRepository.importBases(knowledgeBases, { pruneMissing })
        knowledgeBaseCount = knowledgeImportReport.baseCount
        knowledgeItemCount = knowledgeImportReport.itemCount
        importedKnowledgeBaseCount = knowledgeImportReport.baseCount
        importedKnowledgeItemCount = knowledgeImportReport.itemCount
        deletedKnowledgeBaseCount = knowledgeImportReport.deletedBaseCount
        deletedKnowledgeItemCount = knowledgeImportReport.deletedItemCount
      }

      if (pruneMissing && hasProviderList) {
        deletedProviderCount = await storageV2ProviderRepository.deleteMissing(providers.map((provider) => provider.id))
      }
      if (pruneMissing && hasAssistantList) {
        deletedAssistantCount = await storageV2AssistantRepository.deleteMissing(
          assistantList.map((assistant) => assistant.id)
        )
      }
    }

    return {
      dryRun,
      settingsCount: settingsEntries.length,
      providerCount: providers.length,
      modelCount,
      assistantCount: assistantList.length,
      deletedProviderCount,
      deletedAssistantCount,
      knowledgeBaseCount,
      knowledgeItemCount,
      importedKnowledgeBaseCount,
      importedKnowledgeItemCount,
      deletedKnowledgeBaseCount,
      deletedKnowledgeItemCount,
      secretCandidateCount,
      importedSecretCount,
      skippedSecretCount: secretCandidateCount - importedSecretCount,
      warnings
    }
  }
}

export const storageV2LegacyReduxImportService = new StorageV2LegacyReduxImportService()
