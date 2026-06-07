import { loggerService } from '@logger'
import { knowledgeService } from '@main/services/KnowledgeService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import {
  storageV2KnowledgeRepository,
  storageV2ProviderRepository
} from '@main/services/storageV2/StorageV2Repositories'
import { summarizeTextForLog } from '@main/utils/logging'
import type { KnowledgeBase, KnowledgeBaseParams } from '@types'
import type { Response } from 'express'
import type * as z from 'zod'

import type { KnowledgeSearchSchema } from './validators/zodSchemas'
import type { ValidationRequest } from './validators/zodValidator'

const logger = loggerService.withContext('KnowledgeHandlers')

// Infer types from Zod schemas to avoid duplication
type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>
type ProviderRuntimeConfig = { apiKey: string; baseURL: string }

async function listKnowledgeBasesFromStorageV2(reason: string): Promise<KnowledgeBase[]> {
  try {
    const bases = (await storageV2KnowledgeRepository.listBases()) as KnowledgeBase[]
    if (bases.length > 0) {
      logger.info('Loaded knowledge bases from Storage v2', { reason, count: bases.length })
    }
    return bases
  } catch (error) {
    logger.warn('Failed to load knowledge bases from Storage v2', error as Error)
    return []
  }
}

function firstApiKey(value: unknown): string {
  return typeof value === 'string' ? (value.split(',')[0]?.trim() ?? '') : ''
}

function normalizeBaseURL(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().replace(/#$/, '').replace(/\/+$/, '')
}

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated values (defaults already applied by validator)
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}

    logger.debug('Listing knowledge bases', { limit, offset })

    const bases = await listKnowledgeBasesFromStorageV2('api-list')

    const total = bases?.length || 0
    const paginatedBases = (bases || []).slice(offset, offset + limit)
    return res.json({
      knowledge_bases: paginatedBases,
      total
    })
  } catch (error) {
    logger.error('Failed to list knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to list knowledge bases',
        type: 'internal_error',
        code: 'LIST_KB_ERROR'
      }
    })
  }
}

/**
 * Get a single knowledge base by ID
 */
export const getKnowledgeBase = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Zod already validated id exists and is non-empty
    const { id } = req.validatedParams ?? {}

    logger.debug(`Getting knowledge base: ${id}`)

    const bases = await listKnowledgeBasesFromStorageV2('api-get')
    const base = bases?.find((b) => b.id === id)

    if (!base) {
      return res.status(404).json({
        error: {
          message: `Knowledge base not found: ${id}`,
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    return res.json(base)
  } catch (error) {
    logger.error('Failed to get knowledge base', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to get knowledge base',
        type: 'internal_error',
        code: 'GET_KB_ERROR'
      }
    })
  }
}

async function getProviderConfigFromStorageV2(
  providerId: string,
  reason: string
): Promise<ProviderRuntimeConfig | null> {
  try {
    const [providers, credentialRefsByProvider] = await Promise.all([
      storageV2ProviderRepository.list(),
      storageV2ProviderRepository.listCredentialRefs()
    ])
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return null
    }

    const apiKeyRef = credentialRefsByProvider.get(providerId)?.apiKey
    let apiKey = ''
    if (apiKeyRef) {
      apiKey = firstApiKey(await storageV2SecretVaultService.getSecret(apiKeyRef))
    }

    const config = provider.config ?? {}
    const baseURL = normalizeBaseURL(provider.apiHost ?? config.apiHost)

    logger.info('Loaded provider config from Storage v2', {
      providerId,
      reason,
      hasApiKey: Boolean(apiKey),
      hasBaseURL: Boolean(baseURL)
    })

    return { apiKey, baseURL }
  } catch (error) {
    logger.warn('Failed to load provider config from Storage v2', error as Error)
    return null
  }
}

async function getProviderConfig(providerId: string): Promise<ProviderRuntimeConfig | null> {
  const storageV2Config = await getProviderConfigFromStorageV2(providerId, 'api-provider-config')
  if (storageV2Config) return storageV2Config

  logger.warn(`Provider not found: ${providerId}`)
  return null
}

/**
 * Convert KnowledgeBase to KnowledgeBaseParams for search
 */
async function getKnowledgeBaseParams(base: KnowledgeBase): Promise<KnowledgeBaseParams> {
  // Validate that embedding model provider is configured
  const embedProviderId = base.model?.provider
  if (!embedProviderId) {
    throw new Error(`Knowledge base "${base.name}" is missing embedding model provider configuration`)
  }

  const embedConfig = await getProviderConfig(embedProviderId)
  if (!embedConfig) {
    throw new Error(`Provider "${embedProviderId}" not found for knowledge base "${base.name}"`)
  }

  const embedApiClient = {
    model: base.model?.id || '',
    provider: embedProviderId,
    apiKey: embedConfig.apiKey,
    baseURL: embedConfig.baseURL
  }

  // Build the params object
  const params: KnowledgeBaseParams = {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount
  }

  // Add rerank if configured
  if (base.rerankModel?.provider) {
    const rerankConfig = await getProviderConfig(base.rerankModel.provider)
    if (!rerankConfig) {
      logger.warn(`Rerank provider not found for knowledge base "${base.name}": ${base.rerankModel.provider}`)
    } else {
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

/**
 * Search across knowledge bases
 *
 * This endpoint allows you to search through one or more knowledge bases
 * and retrieve relevant document chunks with similarity scores.
 */
export const searchKnowledge = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated body (defaults already applied by validator)
    const { query, knowledge_base_ids, document_count = 5 } = (req.validatedBody ?? {}) as ValidatedSearchBody

    logger.debug('Searching knowledge bases', {
      query: summarizeTextForLog(query),
      knowledge_base_ids,
      document_count
    })

    const bases = await listKnowledgeBasesFromStorageV2('api-search')

    if (!bases || bases.length === 0) {
      return res.json({
        query,
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio Pi.']
      })
    }

    // Filter by specified knowledge base IDs if provided
    const targetBases = knowledge_base_ids?.length ? bases.filter((b) => knowledge_base_ids.includes(b.id)) : bases

    if (knowledge_base_ids?.length && targetBases.length === 0) {
      return res.status(404).json({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    // Search each knowledge base
    const searchPromises = targetBases.map(async (base) => {
      try {
        const params = await getKnowledgeBaseParams(base)

        // WORKAROUND: knowledgeService.search() expects Electron.IpcMainInvokeEvent for IPC signature.
        // The @TraceMethod decorator doesn't currently access event properties, so passing {} is safe.
        // TODO(v2): Add searchInternal() method to knowledgeService for non-IPC calls.
        const searchResults = await knowledgeService.search({} as Electron.IpcMainInvokeEvent, {
          search: query,
          base: params
        })

        return {
          baseId: base.id,
          baseName: base.name,
          results: searchResults.map((result) => ({
            ...result,
            knowledge_base_id: base.id,
            knowledge_base_name: base.name
          })),
          error: undefined
        }
      } catch (error) {
        logger.error(`Error searching knowledge base ${base.id}`, error as Error)
        return {
          baseId: base.id,
          baseName: base.name,
          results: [],
          error: (error as Error).message
        }
      }
    })

    const resultsPerBase = await Promise.all(searchPromises)

    // Check if all searches failed
    const allFailed = resultsPerBase.every((r) => r.results.length === 0 && r.error)
    if (allFailed && resultsPerBase.length > 0) {
      return res.status(502).json({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failed_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName, error: r.error }))
        }
      })
    }

    // Collect partial failures
    const warnings = resultsPerBase
      .filter((r) => r.error && r.results.length === 0)
      .map((r) => `Knowledge base "${r.baseName}" search failed: ${r.error}`)

    const allResults = resultsPerBase.flatMap((r) => r.results)
    const sortedResults = allResults.sort((a, b) => b.score - a.score).slice(0, document_count)

    logger.debug('Found knowledge search results', {
      query: summarizeTextForLog(query),
      resultCount: sortedResults.length
    })

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searched_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName })),
      ...(warnings.length > 0 && { warnings })
    })
  } catch (error) {
    logger.error('Failed to search knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to search knowledge bases',
        type: 'internal_error',
        code: 'SEARCH_ERROR'
      }
    })
  }
}
