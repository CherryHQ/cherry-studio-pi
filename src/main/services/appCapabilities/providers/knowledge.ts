import { loggerService } from '@logger'
import { knowledgeService } from '@main/services/KnowledgeService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import {
  storageV2KnowledgeRepository,
  storageV2ProviderRepository
} from '@main/services/storageV2/StorageV2Repositories'
import type { KnowledgeBase as RuntimeKnowledgeBase } from '@shared/data/types/knowledge'
import type { KnowledgeBase, KnowledgeBaseParams, KnowledgeItem, Provider } from '@types'
import { v4 as uuidv4 } from 'uuid'

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

function firstApiKey(value: unknown): string {
  return typeof value === 'string' ? (value.split(',')[0]?.trim() ?? '') : ''
}

function normalizeBaseURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/#$/, '').replace(/\/+$/, '')
}

function normalizeKnowledgeBaseItemPreviewLimit(value: unknown): number {
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT
      : Number(value ?? DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT
  return Math.max(0, Math.min(safeLimit, MAX_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT))
}

function normalizeKnowledgeSearchDocumentCount(value: unknown): number {
  const parsed = typeof value === 'string' && !value.trim() ? 5 : Number(value ?? 5)
  const safeCount = Number.isFinite(parsed) ? Math.trunc(parsed) : 5
  return Math.max(1, Math.min(safeCount, 20))
}

function normalizeKnowledgeSearchResultLimit(value: unknown): number {
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT
      : Number(value ?? DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_KNOWLEDGE_SEARCH_RESULT_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_KNOWLEDGE_SEARCH_RESULT_LIMIT))
}

function normalizeOptionalText(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const trimmed = String(value).trim()
    return trimmed || undefined
  }
  return undefined
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value)
  if (!text) throw new Error(`${label} is required`)
  return text
}

function normalizeKnowledgeBaseIds(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const ids = value.flatMap((item) => {
    const id = normalizeOptionalText(item)
    return id ? [id] : []
  })
  return [...new Set(ids)]
}

function normalizeKnowledgeItem(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Knowledge item is required')
  }
  return value as KnowledgeItem
}

function normalizeKnowledgeModel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Knowledge base model is required')
  }
  return value
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

async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  try {
    const bases = (await storageV2KnowledgeRepository.listBases()) as KnowledgeBase[]
    if (bases.length > 0) return bases
  } catch (error) {
    logger.debug('Knowledge Storage v2 repository unavailable, falling back to runtime store bridge', error as Error)
  }

  return (
    (await readRendererStoreValue<KnowledgeBase[]>('state.knowledge.bases', {
      checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
      timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS
    }).catch(() => [])) ?? []
  )
}

async function getProviderConfigFromRuntime(providerId: string): Promise<ProviderRuntimeConfig | null> {
  const providers = await readRendererStoreValue<Provider[]>('state.llm.providers', {
    checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS
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

async function getProviderConfig(providerId: string): Promise<ProviderRuntimeConfig | null> {
  let storageConfig: ProviderRuntimeConfig | null = null
  try {
    storageConfig = await getProviderConfigFromStorageV2(providerId)
    if (hasUsableProviderRuntimeConfig(storageConfig)) return storageConfig
  } catch (error) {
    logger.debug('Provider Storage v2 config unavailable, falling back to runtime store bridge', error as Error)
  }

  try {
    const runtimeConfig = await getProviderConfigFromRuntime(providerId)
    if (runtimeConfig) return runtimeConfig
  } catch (error) {
    logger.debug('Provider runtime store bridge unavailable, falling back to Storage v2', error as Error)
  }

  return storageConfig ?? getProviderConfigFromStorageV2(providerId)
}

function createCachedProviderConfigResolver(): ProviderConfigResolver {
  const cache = new Map<string, Promise<ProviderRuntimeConfig | null>>()
  return (providerId: string) => {
    const cached = cache.get(providerId)
    if (cached) return cached

    const next = getProviderConfig(providerId)
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
    throw new Error(`Knowledge base "${base.name}" is missing embedding model provider configuration`)
  }

  const embedConfig = await resolveProviderConfig(embedProviderId)
  if (!embedConfig) {
    throw new Error(`Provider "${embedProviderId}" not found for knowledge base "${base.name}"`)
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
      execute: async (input: any) => {
        const bases = await listKnowledgeBases()
        return okResult('Knowledge bases listed', {
          total: bases.length,
          knowledge_bases: sanitizeForAgent(bases.map((base) => summarizeKnowledgeBaseForAgent(base, input)))
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
      execute: async (input: any) => {
        const now = Date.now()
        const id = normalizeOptionalText(input?.id) || `kb_${uuidv4()}`
        const name = normalizeRequiredText(input?.name, 'Knowledge base name')
        const model = normalizeKnowledgeModel(input?.model)
        const base = {
          ...input,
          id,
          name,
          model,
          items: Array.isArray(input?.items) ? input.items : [],
          created_at: input?.created_at || now,
          updated_at: now
        } as KnowledgeBase

        const warnings: string[] = []
        if (input?.initialize !== false) {
          try {
            const embeddingModelId = toRuntimeModelId(model)
            const dimensions = Number(base.dimensions)
            if (!embeddingModelId || !Number.isFinite(dimensions) || dimensions <= 0) {
              throw new Error('Missing embedding provider, model id, or dimensions')
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
            const savedBase = runtimeKnowledgeBaseToLegacyMetadata(runtimeBase, base)
            await upsertKnowledgeBaseMetadata(savedBase)
            return {
              ok: true,
              summary: `Knowledge base saved: ${savedBase.name}`,
              data: sanitizeForAgent(savedBase),
              warnings
            }
          } catch (error) {
            warnings.push(`Vector store was not initialized: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        await upsertKnowledgeBaseMetadata(base)
        return {
          ok: true,
          summary: `Knowledge base saved: ${base.name}`,
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
      execute: async (input: any) => {
        const query = String(input?.query || '').trim()
        if (!query) throw new Error('Missing search query')

        const ids = normalizeKnowledgeBaseIds(input?.knowledge_base_ids)
        const documentCount = normalizeKnowledgeSearchDocumentCount(input?.document_count)
        const resultLimit = normalizeKnowledgeSearchResultLimit(input?.result_limit)
        const bases = await listKnowledgeBases()
        const targetBases = ids?.length ? bases.filter((base) => ids.includes(base.id)) : bases
        const resolveProviderConfig = createCachedProviderConfigResolver()
        const resultsPerBase = await mapWithConcurrency(targetBases, KNOWLEDGE_SEARCH_CONCURRENCY, async (base) => {
          try {
            await toKnowledgeBaseParams(base, resolveProviderConfig)
            const results = await knowledgeService.search(base.id, query)
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
            `Returned ${limitedResults.length} of ${results.length} knowledge search results; narrow knowledge_base_ids or raise result_limit.`
          )
        }
        return {
          ok: true,
          summary: `Knowledge search returned ${limitedResults.length} result(s)`,
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
          item: { type: 'object', description: 'Knowledge item payload' },
          forceReload: { type: 'boolean' },
          userId: { type: 'string' }
        },
        required: ['baseId', 'item']
      },
      risk: 'write',
      permissions: ['knowledge.write'],
      sideEffects: ['database.write', 'model.call'],
      tags: ['knowledge', 'rag', 'add', 'ingest'],
      execute: async (input: any) => {
        const baseId = normalizeRequiredText(input?.baseId, 'Knowledge base id')
        const base = (await listKnowledgeBases()).find((item) => item.id === baseId)
        if (!base) throw new Error(`Knowledge base not found: ${baseId}`)
        const knowledgeItem = normalizeKnowledgeItem(input?.item)
        await toKnowledgeBaseParams(base)
        await knowledgeService.addItems(base.id, [knowledgeItem as never])
        const updatedBase = { ...base, items: [...(base.items ?? []), knowledgeItem], updated_at: Date.now() }
        await upsertKnowledgeBaseMetadata(updatedBase)
        return okResult('Knowledge item added', sanitizeForAgent({ baseId: base.id, item: knowledgeItem }))
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
      sideEffects: ['database.write'],
      supportsDryRun: true,
      tags: ['knowledge', 'rag', 'reset'],
      execute: async (input: any, context) => {
        const baseId = normalizeRequiredText(input?.baseId, 'Knowledge base id')
        const base = (await listKnowledgeBases()).find((item) => item.id === baseId)
        if (!base) throw new Error(`Knowledge base not found: ${baseId}`)
        if (context.dryRun) return okResult('Knowledge base reset dry run completed', { baseId: base.id })
        await toKnowledgeBaseParams(base)
        const roots = await knowledgeService.listRootItems(base.id)
        if (roots.length > 0) {
          await knowledgeService.reindexItems(
            base.id,
            roots.map((item) => item.id)
          )
        }
        return okResult('Knowledge base reset', { baseId: base.id, name: base.name })
      }
    }
  ]
}
