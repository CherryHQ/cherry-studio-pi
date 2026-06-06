import { loggerService } from '@logger'
import KnowledgeService from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import {
  storageV2KnowledgeRepository,
  storageV2ProviderRepository
} from '@main/services/storageV2/StorageV2Repositories'
import type { KnowledgeBase, KnowledgeBaseParams, KnowledgeItem, Provider } from '@types'
import { v4 as uuidv4 } from 'uuid'

import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapabilities:Knowledge')

type ProviderRuntimeConfig = { apiKey: string; baseURL: string }
type ProviderConfigResolver = (providerId: string) => Promise<ProviderRuntimeConfig | null>

const KNOWLEDGE_SEARCH_CONCURRENCY = 3
const DEFAULT_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT = 20
const MAX_KNOWLEDGE_BASE_ITEM_PREVIEW_LIMIT = 100

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

function summarizeKnowledgeBaseForAgent(base: KnowledgeBase, input: any = {}) {
  const includeItems = input?.includeItems === true
  const itemLimit = normalizeKnowledgeBaseItemPreviewLimit(input?.itemLimit)
  const items = Array.isArray(base.items) ? base.items : []
  const { items: _items, ...summary } = base

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

function isReduxUnavailableError(error: unknown): boolean {
  const message = (error as Error)?.message || ''
  return message.includes('Main window is not available') || message.includes('Timeout waiting for Redux store')
}

async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  try {
    const bases = (await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')) ?? []
    if (bases.length > 0) return bases
  } catch (error) {
    if (!isReduxUnavailableError(error)) throw error
  }

  return (await storageV2KnowledgeRepository.listBases()) as KnowledgeBase[]
}

async function getProviderConfigFromRedux(providerId: string): Promise<ProviderRuntimeConfig | null> {
  const providers = await reduxService.select<Provider[]>('state.llm.providers')
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

async function getProviderConfig(providerId: string): Promise<ProviderRuntimeConfig | null> {
  try {
    const config = await getProviderConfigFromRedux(providerId)
    if (config) return config
  } catch (error) {
    if (!isReduxUnavailableError(error)) throw error
  }

  return getProviderConfigFromStorageV2(providerId)
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
  const bases = await listKnowledgeBases().catch(() => [])
  const exists = bases.some((item) => item.id === base.id)
  await storageV2KnowledgeRepository.importBases([base as any], { pruneMissing: false })
  await reduxService
    .dispatch({ type: exists ? 'knowledge/updateBase' : 'knowledge/addBase', payload: base })
    .catch((error) => {
      if (!isReduxUnavailableError(error)) {
        logger.warn('Failed to mirror knowledge base to Redux', error as Error)
      }
    })
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
        const base = {
          ...input,
          id: input?.id || `kb_${uuidv4()}`,
          items: Array.isArray(input?.items) ? input.items : [],
          created_at: input?.created_at || now,
          updated_at: now
        } as KnowledgeBase

        await upsertKnowledgeBaseMetadata(base)

        const warnings: string[] = []
        if (input?.initialize !== false) {
          try {
            await KnowledgeService.create({} as Electron.IpcMainInvokeEvent, await toKnowledgeBaseParams(base))
          } catch (error) {
            warnings.push(`Vector store was not initialized: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

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
          document_count: { type: 'number', default: 5 }
        },
        required: ['query']
      },
      risk: 'read',
      tags: ['knowledge', 'rag', 'search'],
      execute: async (input: any) => {
        const query = String(input?.query || '').trim()
        if (!query) throw new Error('Missing search query')

        const ids = Array.isArray(input?.knowledge_base_ids) ? input.knowledge_base_ids : undefined
        const documentCount = Math.max(1, Math.min(Number(input?.document_count || 5), 20))
        const bases = await listKnowledgeBases()
        const targetBases = ids?.length ? bases.filter((base) => ids.includes(base.id)) : bases
        const resolveProviderConfig = createCachedProviderConfigResolver()
        const resultsPerBase = await mapWithConcurrency(targetBases, KNOWLEDGE_SEARCH_CONCURRENCY, async (base) => {
          try {
            const params = await toKnowledgeBaseParams(base, resolveProviderConfig)
            const results = await KnowledgeService.search({} as Electron.IpcMainInvokeEvent, {
              search: query,
              base: params
            })
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
        const warnings = resultsPerBase.flatMap((item) => (item.error ? [`${item.baseName}: ${item.error}`] : []))
        return {
          ok: true,
          summary: `Knowledge search returned ${results.length} result(s)`,
          data: {
            query,
            total: results.length,
            searched_bases: targetBases.map((base) => ({ id: base.id, name: base.name })),
            results: sanitizeForAgent(results)
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
        const base = (await listKnowledgeBases()).find((item) => item.id === input?.baseId)
        if (!base) throw new Error(`Knowledge base not found: ${input?.baseId}`)
        const knowledgeItem = input?.item as KnowledgeItem
        const result = await KnowledgeService.add({} as Electron.IpcMainInvokeEvent, {
          base: await toKnowledgeBaseParams(base),
          item: knowledgeItem,
          forceReload: input?.forceReload,
          userId: input?.userId
        })
        const updatedBase = { ...base, items: [...(base.items ?? []), knowledgeItem], updated_at: Date.now() }
        await upsertKnowledgeBaseMetadata(updatedBase)
        return okResult('Knowledge item added', sanitizeForAgent(result))
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
      tags: ['knowledge', 'rag', 'reset'],
      execute: async (input: any, context) => {
        const base = (await listKnowledgeBases()).find((item) => item.id === input?.baseId)
        if (!base) throw new Error(`Knowledge base not found: ${input?.baseId}`)
        if (context.dryRun) return okResult('Knowledge base reset dry run completed', { baseId: base.id })
        await KnowledgeService.reset({} as Electron.IpcMainInvokeEvent, await toKnowledgeBaseParams(base))
        return okResult('Knowledge base reset', { baseId: base.id, name: base.name })
      }
    }
  ]
}
