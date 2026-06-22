import { loggerService } from '@logger'
import type { Provider } from '@main/data/migration/v2/legacyTypes'
import { knowledgeService } from '@main/services/KnowledgeService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import {
  storageV2KnowledgeRepository,
  storageV2ProviderRepository
} from '@main/services/storageV2/StorageV2Repositories'
import type { KnowledgeBase as RuntimeKnowledgeBase } from '@shared/data/types/knowledge'
import type { KnowledgeBase, KnowledgeBaseParams, KnowledgeItem } from '@shared/types/legacyKnowledge'
import { v4 as uuidv4 } from 'uuid'

import { normalizeBoundedIntegerInput } from '../input'
import { readRendererStoreValue } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapabilities:Knowledge')

type ProviderRuntimeConfig = { apiKey: string; baseURL: string }
type ProviderConfigResolver = (providerId: string) => Promise<ProviderRuntimeConfig | null>

const KNOWLEDGE_SEARCH_CONCURRENCY = 3
const DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT = 20
const MAX_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT = 100
const DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT = 50
const MAX_KNOWLEDGE_SEARCH_RESULT_LIMIT = 100
const RENDERER_STORE_FALLBACK_TIMEOUT_MS = 1_000
const KNOWLEDGE_ABORT_ERROR = '知识库能力调用已取消。'
const KNOWLEDGE_INPUT_OBJECT_ERROR = '知识库能力的输入必须是对象。'
const KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT_TYPE_ERROR = '知识库条目预览数量必须是数字。'
const KNOWLEDGE_SEARCH_DOCUMENT_COUNT_TYPE_ERROR = '知识库搜索文档数量必须是数字。'
const KNOWLEDGE_SEARCH_RESULT_LIMIT_TYPE_ERROR = '知识库搜索结果数量必须是数字。'
const KNOWLEDGE_TEXT_STRING_ERROR_SUFFIX = '必须是字符串。'
const KNOWLEDGE_TEXT_REQUIRED_ERROR_SUFFIX = '不能为空。'
const KNOWLEDGE_ARRAY_ERROR_SUFFIX = '必须是数组。'
const KNOWLEDGE_TIMESTAMP_ERROR_SUFFIX = '必须是有限数字或有效日期字符串。'
const DEFAULT_TEXT_LABEL = '输入值'
const KNOWLEDGE_BASE_ID_LABEL = '知识库 ID '
const KNOWLEDGE_BASE_NAME_LABEL = '知识库名称'
const KNOWLEDGE_SEARCH_QUERY_LABEL = '知识库搜索关键词'
const KNOWLEDGE_BASE_CREATED_AT_LABEL = '知识库创建时间'
const KNOWLEDGE_BASE_IDS_LABEL = '知识库 ID 列表'
const KNOWLEDGE_BASE_ITEMS_LABEL = '知识库条目列表'
const KNOWLEDGE_ITEM_REQUIRED_ERROR = '知识库条目不能为空。'
const KNOWLEDGE_BASE_MODEL_REQUIRED_ERROR = '知识库模型不能为空。'
const KNOWLEDGE_BASE_NOT_FOUND_PREFIX = '未找到知识库：'
const KNOWLEDGE_BASE_NAME_PREFIX = '知识库“'
const KNOWLEDGE_EMBEDDING_CONFIG_MISSING_SUFFIX = '”缺少嵌入模型服务商配置。'
const PROVIDER_NOT_FOUND_FOR_KNOWLEDGE_BASE_PREFIX = '未找到知识库“'
const PROVIDER_NOT_FOUND_FOR_KNOWLEDGE_BASE_MIDDLE = '”使用的服务商：'
const MISSING_EMBEDDING_MODEL_ERROR = '缺少嵌入服务商、模型 ID 或向量维度。'
const VECTOR_STORE_WARNING_PREFIX = '向量库未初始化：'
const KNOWLEDGE_BASES_LISTED_SUMMARY = '已列出知识库'
const KNOWLEDGE_BASE_SAVED_PREFIX = '知识库已保存：'
const KNOWLEDGE_SEARCH_RETURNED_PREFIX = '知识库搜索返回 '
const KNOWLEDGE_SEARCH_RETURNED_SUFFIX = ' 条结果'
const KNOWLEDGE_ITEM_ADDED_SUMMARY = '知识库条目已添加'
const KNOWLEDGE_BASE_RESET_DRY_RUN_SUMMARY = '知识库重置演练已完成'
const KNOWLEDGE_BASE_RESET_SUMMARY = '知识库已重置'
const KNOWLEDGE_BASE_METADATA_FIELDS = [
  'dimensions',
  'description',
  'documentCount',
  'chunkSize',
  'chunkOverlap',
  'threshold',
  'rerankModel',
  'preprocessProvider',
  'version'
] as const satisfies readonly (keyof KnowledgeBase)[]

function throwIfKnowledgeSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error(KNOWLEDGE_ABORT_ERROR)
}

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(KNOWLEDGE_INPUT_OBJECT_ERROR)
  return input as Record<string, unknown>
}

function firstApiKey(value: unknown): string {
  return typeof value === 'string' ? (value.split(',')[0]?.trim() ?? '') : ''
}

function normalizeBaseURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/#$/, '').replace(/\/+$/, '')
}

function normalizeKnowledgeBaseItemPreviewLimit(value: unknown): number {
  return normalizeBoundedIntegerInput(value, {
    label: 'Knowledge base item preview limit',
    defaultValue: DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT,
    min: 0,
    max: MAX_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT,
    invalidTypeMessage: KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT_TYPE_ERROR
  })
}

function normalizeKnowledgeSearchDocumentCount(value: unknown): number {
  return normalizeBoundedIntegerInput(value, {
    label: 'Knowledge search document count',
    defaultValue: 5,
    min: 1,
    max: 20,
    invalidTypeMessage: KNOWLEDGE_SEARCH_DOCUMENT_COUNT_TYPE_ERROR
  })
}

function normalizeKnowledgeSearchResultLimit(value: unknown): number {
  return normalizeBoundedIntegerInput(value, {
    label: 'Knowledge search result limit',
    defaultValue: DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT,
    min: 1,
    max: MAX_KNOWLEDGE_SEARCH_RESULT_LIMIT,
    invalidTypeMessage: KNOWLEDGE_SEARCH_RESULT_LIMIT_TYPE_ERROR
  })
}

function normalizeOptionalText(value: unknown, label = DEFAULT_TEXT_LABEL) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  throw new Error(label + KNOWLEDGE_TEXT_STRING_ERROR_SUFFIX)
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(label + KNOWLEDGE_TEXT_REQUIRED_ERROR_SUFFIX)
  return text
}

function normalizeKnowledgeBaseIds(value: unknown) {
  if (value === null || typeof value === 'undefined') return undefined
  if (!Array.isArray(value)) throw new Error(KNOWLEDGE_BASE_IDS_LABEL + KNOWLEDGE_ARRAY_ERROR_SUFFIX)
  const ids = value.flatMap((item) => {
    const id = normalizeOptionalText(item, KNOWLEDGE_BASE_ID_LABEL)
    return id ? [id] : []
  })
  return [...new Set(ids)]
}

function normalizeKnowledgeItem(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(KNOWLEDGE_ITEM_REQUIRED_ERROR)
  }
  return value as KnowledgeItem
}

function normalizeKnowledgeItems(value: unknown) {
  if (value === null || typeof value === 'undefined') return []
  if (!Array.isArray(value)) throw new Error(KNOWLEDGE_BASE_ITEMS_LABEL + KNOWLEDGE_ARRAY_ERROR_SUFFIX)
  return value.map((item) => normalizeKnowledgeItem(item))
}

function normalizeOptionalTimestamp(value: unknown, label: string, fallback: number) {
  if (value === null || typeof value === 'undefined') return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(label + KNOWLEDGE_TIMESTAMP_ERROR_SUFFIX)
}

function normalizeKnowledgeModel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(KNOWLEDGE_BASE_MODEL_REQUIRED_ERROR)
  }
  return value
}

function createKnowledgeBaseMetadata(
  input: any,
  params: {
    id: string
    name: string
    model: unknown
    items: KnowledgeItem[]
    createdAt: number
    updatedAt: number
  }
): KnowledgeBase {
  const base: Partial<KnowledgeBase> = {
    id: params.id,
    name: params.name,
    model: params.model as KnowledgeBase['model'],
    items: params.items,
    created_at: params.createdAt,
    updated_at: params.updatedAt
  }

  const inputRecord = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const mutableBase = base as Record<string, unknown>
  for (const field of KNOWLEDGE_BASE_METADATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(inputRecord, field) && typeof inputRecord[field] !== 'undefined') {
      mutableBase[field] = inputRecord[field]
    }
  }

  return base as KnowledgeBase
}

function toRuntimeModelId(model: unknown) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return ''

  const modelRecord = model as Record<string, unknown>
  const provider = typeof modelRecord.provider === 'string' ? modelRecord.provider.trim() : ''
  const modelId = typeof modelRecord.id === 'string' ? modelRecord.id.trim() : ''
  if (!provider || !modelId) return ''
  return modelId.includes('::') ? modelId : `${provider}::${modelId}`
}

function modelFromRuntimeModelId(modelId: string | null | undefined) {
  const trimmed = typeof modelId === 'string' ? modelId.trim() : ''
  if (!trimmed) return undefined

  const separatorIndex = trimmed.indexOf('::')
  const provider = separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : ''
  const id = separatorIndex > 0 ? trimmed.slice(separatorIndex + 2) : trimmed
  if (!id) return undefined

  return {
    id,
    provider,
    name: id,
    group: provider
  }
}

function parseRuntimeTimestamp(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return fallback

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function runtimeKnowledgeBaseToLegacyMetadata(
  runtimeBase: RuntimeKnowledgeBase,
  fallback: KnowledgeBase
): KnowledgeBase {
  const now = Date.now()
  return {
    ...fallback,
    id: runtimeBase.id,
    name: runtimeBase.name,
    model: fallback.model ?? modelFromRuntimeModelId(runtimeBase.embeddingModelId) ?? fallback.model,
    dimensions: runtimeBase.dimensions ?? fallback.dimensions,
    chunkSize: runtimeBase.chunkSize ?? fallback.chunkSize,
    chunkOverlap: runtimeBase.chunkOverlap ?? fallback.chunkOverlap,
    threshold: runtimeBase.threshold ?? fallback.threshold,
    documentCount: runtimeBase.documentCount ?? fallback.documentCount,
    rerankModel: fallback.rerankModel ?? modelFromRuntimeModelId(runtimeBase.rerankModelId),
    items: fallback.items ?? [],
    created_at: parseRuntimeTimestamp(runtimeBase.createdAt, fallback.created_at ?? now),
    updated_at: parseRuntimeTimestamp(runtimeBase.updatedAt, fallback.updated_at ?? now),
    version: fallback.version ?? 1
  }
}

function summarizeKnowledgeBaseForAgent(base: KnowledgeBase, input: any = {}) {
  const includeItems = input?.includeItems === true
  const itemLimit = normalizeKnowledgeBaseItemPreviewLimit(input?.itemLimit)
  const items = Array.isArray(base.items) ? base.items : []
  const summary = { ...base } as Partial<KnowledgeBase>
  delete summary.items

  return {
    ...summary,
    itemCount: items.length,
    ...(includeItems
      ? {
          items: items.slice(0, itemLimit),
          ...(items.length > itemLimit ? { itemsTruncated: items.length - itemLimit } : {})
        }
      : {})
  }
}

async function listKnowledgeBases(signal?: AbortSignal): Promise<KnowledgeBase[]> {
  throwIfKnowledgeSignalAborted(signal)
  try {
    const bases = (await storageV2KnowledgeRepository.listBases()) as KnowledgeBase[]
    if (bases.length > 0) return bases
  } catch (error) {
    if (signal?.aborted) throw error
    logger.debug('Knowledge Storage v2 repository unavailable, falling back to runtime store bridge', error as Error)
  }

  return (
    (await readRendererStoreValue<KnowledgeBase[]>('state.knowledge.bases', {
      checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
      timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
      signal
    }).catch((error) => {
      if (signal?.aborted) throw error
      return []
    })) ?? []
  )
}

async function getProviderConfigFromRuntime(
  providerId: string,
  signal?: AbortSignal
): Promise<ProviderRuntimeConfig | null> {
  const providers = await readRendererStoreValue<Provider[]>('state.llm.providers', {
    checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    signal
  })
  const provider = providers?.find((item) => item.id === providerId)
  if (!provider) return null
  return {
    apiKey: firstApiKey(provider.apiKey),
    baseURL: normalizeBaseURL(provider.apiHost)
  }
}

async function getProviderConfigFromStorageV2(providerId: string): Promise<ProviderRuntimeConfig | null> {
  const [providers, credentialRefsByProvider] = await Promise.all([
    storageV2ProviderRepository.list(),
    storageV2ProviderRepository.listCredentialRefs()
  ])
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return null

  const apiKeyRef = credentialRefsByProvider.get(providerId)?.apiKey
  const apiKey = apiKeyRef ? firstApiKey(await storageV2SecretVaultService.getSecret(apiKeyRef)) : ''
  const config = provider.config ?? {}
  return {
    apiKey,
    baseURL: normalizeBaseURL(provider.apiHost ?? config.apiHost)
  }
}

function hasUsableProviderRuntimeConfig(config: ProviderRuntimeConfig | null) {
  return Boolean(config && (config.apiKey || config.baseURL))
}

async function getProviderConfig(providerId: string, signal?: AbortSignal): Promise<ProviderRuntimeConfig | null> {
  throwIfKnowledgeSignalAborted(signal)
  let storageConfig: ProviderRuntimeConfig | null = null
  try {
    storageConfig = await getProviderConfigFromStorageV2(providerId)
    if (hasUsableProviderRuntimeConfig(storageConfig)) return storageConfig
  } catch (error) {
    if (signal?.aborted) throw error
    logger.debug('Provider Storage v2 config unavailable, falling back to runtime store bridge', error as Error)
  }

  try {
    const runtimeConfig = await getProviderConfigFromRuntime(providerId, signal)
    if (runtimeConfig) return runtimeConfig
  } catch (error) {
    if (signal?.aborted) throw error
    logger.debug('Provider runtime store bridge unavailable, falling back to Storage v2', error as Error)
  }

  return storageConfig ?? getProviderConfigFromStorageV2(providerId)
}

function createCachedProviderConfigResolver(signal?: AbortSignal): ProviderConfigResolver {
  const cache = new Map<string, Promise<ProviderRuntimeConfig | null>>()
  return (providerId: string) => {
    const cached = cache.get(providerId)
    if (cached) return cached

    const next = getProviderConfig(providerId, signal)
    cache.set(providerId, next)
    return next
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  })

  await Promise.all(workers)
  return results
}

async function toKnowledgeBaseParams(
  base: KnowledgeBase,
  resolveProviderConfig: ProviderConfigResolver = getProviderConfig
): Promise<KnowledgeBaseParams> {
  const embedProviderId = base.model?.provider
  if (!embedProviderId) {
    throw new Error(KNOWLEDGE_BASE_NAME_PREFIX + base.name + KNOWLEDGE_EMBEDDING_CONFIG_MISSING_SUFFIX)
  }

  const embedConfig = await resolveProviderConfig(embedProviderId)
  if (!embedConfig) {
    throw new Error(
      PROVIDER_NOT_FOUND_FOR_KNOWLEDGE_BASE_PREFIX +
        base.name +
        PROVIDER_NOT_FOUND_FOR_KNOWLEDGE_BASE_MIDDLE +
        embedProviderId
    )
  }

  const params: KnowledgeBaseParams = {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient: {
      model: base.model?.id || '',
      provider: embedProviderId,
      apiKey: embedConfig.apiKey,
      baseURL: embedConfig.baseURL
    },
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount
  }

  if (base.rerankModel?.provider) {
    const rerankConfig = await resolveProviderConfig(base.rerankModel.provider)
    if (rerankConfig) {
      params.rerankApiClient = {
        model: base.rerankModel.id || '',
        provider: base.rerankModel.provider,
        apiKey: rerankConfig.apiKey,
        baseURL: rerankConfig.baseURL
      }
    }
  }

  return params
}

async function upsertKnowledgeBaseMetadata(base: KnowledgeBase) {
  await storageV2KnowledgeRepository.importBases([base as any], { pruneMissing: false })
}

export function createKnowledgeCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'knowledge.bases.list',
      domain: 'knowledge',
      kind: 'query',
      title: 'List knowledge bases',
      description: 'List configured knowledge bases with lightweight metadata by default.',
      inputSchema: {
        type: 'object',
        properties: {
          includeItems: {
            type: 'boolean',
            description: 'Include a bounded preview of knowledge items; defaults to false'
          },
          itemLimit: {
            type: 'number',
            description: 'Maximum items per base when includeItems is true; defaults to 20 and is capped at 100'
          }
        }
      },
      risk: 'read',
      tags: ['knowledge', 'rag', 'list'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const bases = await listKnowledgeBases(context.signal)
        return okResult(KNOWLEDGE_BASES_LISTED_SUMMARY, {
          total: bases.length,
          knowledge_bases: sanitizeForAgent(bases.map((base) => summarizeKnowledgeBaseForAgent(base, inputObject)))
        })
      }
    },
    {
      id: 'knowledge.base.create',
      domain: 'knowledge',
      kind: 'command',
      title: 'Create knowledge base',
      description:
        'Create or update knowledge base metadata. If provider configuration is complete, also initialize the vector store.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Optional knowledge base id' },
          name: { type: 'string', description: 'Knowledge base name' },
          model: {
            type: 'object',
            description: 'Embedding model, for example { id: "text-embedding-3-small", provider: "openai" }'
          },
          dimensions: { type: 'number' },
          chunkSize: { type: 'number' },
          chunkOverlap: { type: 'number' },
          documentCount: { type: 'number' },
          threshold: { type: 'number' },
          initialize: { type: 'boolean', default: true }
        },
        required: ['name', 'model']
      },
      risk: 'write',
      permissions: ['knowledge.write'],
      sideEffects: ['database.write', 'filesystem.write'],
      tags: ['knowledge', 'rag', 'create'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const now = Date.now()
        const id = normalizeOptionalText(inputObject.id, KNOWLEDGE_BASE_ID_LABEL) || `kb_${uuidv4()}`
        const name = normalizeRequiredText(inputObject.name, KNOWLEDGE_BASE_NAME_LABEL)
        const model = normalizeKnowledgeModel(inputObject.model)
        const items = normalizeKnowledgeItems(inputObject.items)
        const createdAt = normalizeOptionalTimestamp(inputObject.created_at, KNOWLEDGE_BASE_CREATED_AT_LABEL, now)
        const base = createKnowledgeBaseMetadata(inputObject, {
          id,
          name,
          model,
          items,
          createdAt,
          updatedAt: now
        })
        throwIfKnowledgeSignalAborted(context.signal)

        const warnings: string[] = []
        if (inputObject.initialize !== false) {
          try {
            throwIfKnowledgeSignalAborted(context.signal)
            const embeddingModelId = toRuntimeModelId(model)
            const dimensions = Number(base.dimensions)
            if (!embeddingModelId || !Number.isFinite(dimensions) || dimensions <= 0) {
              throw new Error(MISSING_EMBEDDING_MODEL_ERROR)
            }
            const runtimeBase = await knowledgeService.createBase({
              name: base.name,
              dimensions,
              embeddingModelId,
              chunkSize: base.chunkSize,
              chunkOverlap: base.chunkOverlap,
              documentCount: base.documentCount,
              threshold: base.threshold,
              rerankModelId: toRuntimeModelId(base.rerankModel) || undefined,
              fileProcessorId: base.preprocessProvider?.provider?.id,
              searchMode: 'vector'
            })
            throwIfKnowledgeSignalAborted(context.signal)
            const savedBase = runtimeKnowledgeBaseToLegacyMetadata(runtimeBase, base)
            await upsertKnowledgeBaseMetadata(savedBase)
            throwIfKnowledgeSignalAborted(context.signal)
            return {
              ok: true,
              summary: KNOWLEDGE_BASE_SAVED_PREFIX + savedBase.name,
              data: sanitizeForAgent(savedBase),
              warnings
            }
          } catch (error) {
            if (context.signal?.aborted) throw error
            warnings.push(VECTOR_STORE_WARNING_PREFIX + (error instanceof Error ? error.message : String(error)))
          }
        }

        await upsertKnowledgeBaseMetadata(base)
        throwIfKnowledgeSignalAborted(context.signal)
        return {
          ok: true,
          summary: KNOWLEDGE_BASE_SAVED_PREFIX + base.name,
          data: sanitizeForAgent(base),
          warnings
        }
      }
    },
    {
      id: 'knowledge.search',
      domain: 'knowledge',
      kind: 'query',
      title: 'Search knowledge bases',
      description: 'Search one or more configured knowledge bases by id. Searches all bases when ids are omitted.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          knowledge_base_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional knowledge base ids to search'
          },
          document_count: { type: 'number', default: 5 },
          result_limit: {
            type: 'number',
            default: DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT,
            description: 'Maximum total results returned to the agent; defaults to 50 and is capped at 100'
          }
        },
        required: ['query']
      },
      risk: 'read',
      tags: ['knowledge', 'rag', 'search'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const query = normalizeRequiredText(inputObject.query, KNOWLEDGE_SEARCH_QUERY_LABEL)

        const ids = normalizeKnowledgeBaseIds(inputObject.knowledge_base_ids)
        const documentCount = normalizeKnowledgeSearchDocumentCount(inputObject.document_count)
        const resultLimit = normalizeKnowledgeSearchResultLimit(inputObject.result_limit)
        const bases = await listKnowledgeBases(context.signal)
        const targetBases = ids?.length ? bases.filter((base) => ids.includes(base.id)) : bases
        if (ids?.length) {
          const foundIds = new Set(targetBases.map((base) => base.id))
          const missingIds = ids.filter((id) => !foundIds.has(id))
          if (missingIds.length > 0) {
            throw new Error(KNOWLEDGE_BASE_NOT_FOUND_PREFIX + missingIds.join(', '))
          }
        }
        const resolveProviderConfig = createCachedProviderConfigResolver(context.signal)
        const resultsPerBase = await mapWithConcurrency(targetBases, KNOWLEDGE_SEARCH_CONCURRENCY, async (base) => {
          try {
            throwIfKnowledgeSignalAborted(context.signal)
            await toKnowledgeBaseParams(base, resolveProviderConfig)
            const results = await knowledgeService.search(base.id, query)
            throwIfKnowledgeSignalAborted(context.signal)
            return {
              baseId: base.id,
              baseName: base.name,
              results: results.slice(0, documentCount).map((result) => ({
                ...result,
                knowledge_base_id: base.id,
                knowledge_base_name: base.name
              }))
            }
          } catch (error) {
            if (context.signal?.aborted) throw error
            return {
              baseId: base.id,
              baseName: base.name,
              results: [],
              error: error instanceof Error ? error.message : String(error)
            }
          }
        })
        const results = resultsPerBase.flatMap((item) => item.results)
        const limitedResults = results.slice(0, resultLimit)
        const truncatedCount = Math.max(0, results.length - limitedResults.length)
        const warnings = resultsPerBase.flatMap((item) => (item.error ? [`${item.baseName}: ${item.error}`] : []))
        if (truncatedCount > 0) {
          warnings.push(
            '已返回 ' +
              limitedResults.length +
              ' / ' +
              results.length +
              ' 条知识库搜索结果；请缩小 knowledge_base_ids 范围或提高 result_limit。'
          )
        }
        return {
          ok: true,
          summary: KNOWLEDGE_SEARCH_RETURNED_PREFIX + limitedResults.length + KNOWLEDGE_SEARCH_RETURNED_SUFFIX,
          data: {
            query,
            total: limitedResults.length,
            total_before_limit: results.length,
            result_limit: resultLimit,
            truncated: truncatedCount > 0,
            truncated_count: truncatedCount,
            searched_bases: targetBases.map((base) => ({ id: base.id, name: base.name })),
            results: sanitizeForAgent(limitedResults)
          },
          warnings
        }
      }
    },
    {
      id: 'knowledge.item.add',
      domain: 'knowledge',
      kind: 'command',
      title: 'Add knowledge item',
      description: 'Add a file, directory, URL, sitemap, or note item to a knowledge base.',
      inputSchema: {
        type: 'object',
        properties: {
          baseId: { type: 'string' },
          item: { type: 'object', description: 'Knowledge item payload' }
        },
        required: ['baseId', 'item']
      },
      risk: 'write',
      permissions: ['knowledge.write'],
      sideEffects: ['database.write', 'filesystem.read', 'filesystem.write', 'model.call', 'network'],
      tags: ['knowledge', 'rag', 'add', 'ingest'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const baseId = normalizeRequiredText(inputObject.baseId, KNOWLEDGE_BASE_ID_LABEL)
        const base = (await listKnowledgeBases(context.signal)).find((item) => item.id === baseId)
        if (!base) throw new Error(KNOWLEDGE_BASE_NOT_FOUND_PREFIX + baseId)
        const knowledgeItem = normalizeKnowledgeItem(inputObject.item)
        await toKnowledgeBaseParams(base, (providerId) => getProviderConfig(providerId, context.signal))
        throwIfKnowledgeSignalAborted(context.signal)
        await knowledgeService.addItems(base.id, [knowledgeItem as never])
        throwIfKnowledgeSignalAborted(context.signal)
        const updatedBase = { ...base, items: [...(base.items ?? []), knowledgeItem], updated_at: Date.now() }
        await upsertKnowledgeBaseMetadata(updatedBase)
        throwIfKnowledgeSignalAborted(context.signal)
        return okResult(KNOWLEDGE_ITEM_ADDED_SUMMARY, sanitizeForAgent({ baseId: base.id, item: knowledgeItem }))
      }
    },
    {
      id: 'knowledge.base.reset',
      domain: 'knowledge',
      kind: 'command',
      title: 'Reset knowledge base vector store',
      description: 'Reset the vector store for a knowledge base without deleting its metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          baseId: { type: 'string' }
        },
        required: ['baseId']
      },
      risk: 'destructive',
      permissions: ['knowledge.reset'],
      sideEffects: ['database.write', 'filesystem.read', 'model.call', 'network'],
      supportsDryRun: true,
      tags: ['knowledge', 'rag', 'reset'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const baseId = normalizeRequiredText(inputObject.baseId, KNOWLEDGE_BASE_ID_LABEL)
        const base = (await listKnowledgeBases(context.signal)).find((item) => item.id === baseId)
        if (!base) throw new Error(KNOWLEDGE_BASE_NOT_FOUND_PREFIX + baseId)
        if (context.dryRun) return okResult(KNOWLEDGE_BASE_RESET_DRY_RUN_SUMMARY, { baseId: base.id })
        await toKnowledgeBaseParams(base, (providerId) => getProviderConfig(providerId, context.signal))
        throwIfKnowledgeSignalAborted(context.signal)
        const roots = await knowledgeService.listRootItems(base.id)
        throwIfKnowledgeSignalAborted(context.signal)
        if (roots.length > 0) {
          await knowledgeService.reindexItems(
            base.id,
            roots.map((item) => item.id)
          )
          throwIfKnowledgeSignalAborted(context.signal)
        }
        return okResult(KNOWLEDGE_BASE_RESET_SUMMARY, { baseId: base.id, name: base.name })
      }
    }
  ]
}
