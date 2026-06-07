import { loggerService } from '@logger'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import { storageV2ProviderRepository } from '@main/services/storageV2/StorageV2Repositories'
import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { net } from 'electron'

import { parseCompositeModelId } from '../utils/model/config'
import { getRerankAdapter } from './adapters'
import type { ResolvedRerankRuntime } from './types'

const logger = loggerService.withContext('KnowledgeRerank')
const RERANK_REQUEST_TIMEOUT_MS = 60_000

function firstApiKey(value: unknown): string {
  return typeof value === 'string' ? (value.split(',')[0]?.trim() ?? '') : ''
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/g, '')
}

function canUsePasswordlessRerankProvider(providerId: string) {
  return providerId.includes('tei')
}

function mergeRerankResults(
  searchResults: KnowledgeSearchResult[],
  rerankResults: Array<{ index: number; relevanceScore: number }>
): KnowledgeSearchResult[] {
  const resultMap = new Map(
    rerankResults.map((result) => [result.index, result.relevanceScore ?? DEFAULT_RELEVANT_SCORE])
  )

  const rerankedResults: KnowledgeSearchResult[] = []

  for (const [index, result] of searchResults.entries()) {
    const score = resultMap.get(index)
    if (score === undefined) {
      continue
    }

    rerankedResults.push({ ...result, score, scoreKind: 'relevance' })
  }

  return rerankedResults.sort((a, b) => b.score - a.score).map((result, index) => ({ ...result, rank: index + 1 }))
}

export async function resolveRerankRuntime(base: KnowledgeBase): Promise<ResolvedRerankRuntime | null> {
  if (!base.rerankModelId) {
    return null
  }

  const { providerId, modelId } = parseCompositeModelId(base.rerankModelId)
  const providers = await storageV2ProviderRepository.list()
  const provider = providers.find((item) => item.id === providerId)

  if (!provider) {
    logger.warn('Skipping knowledge rerank because provider is not configured', {
      providerId,
      rerankModelId: base.rerankModelId
    })
    return null
  }

  const baseUrl = normalizeBaseUrl(provider.apiHost ?? provider.config?.apiHost)
  if (!baseUrl) {
    logger.warn('Skipping knowledge rerank because provider API host is empty', {
      providerId,
      rerankModelId: base.rerankModelId
    })
    return null
  }

  const credentialRefs = await storageV2ProviderRepository.listCredentialRefs()
  const apiKeySecretRef = credentialRefs.get(providerId)?.apiKey
  const apiKey = firstApiKey(apiKeySecretRef ? await storageV2SecretVaultService.getSecret(apiKeySecretRef) : '')

  if (!apiKey && !canUsePasswordlessRerankProvider(providerId)) {
    logger.warn('Skipping knowledge rerank because provider API key is missing', {
      providerId,
      rerankModelId: base.rerankModelId
    })
    return null
  }

  return {
    providerId,
    modelId,
    baseUrl,
    apiKey
  }
}

export async function executeRerankRequest(
  runtime: ResolvedRerankRuntime,
  query: string,
  searchResults: KnowledgeSearchResult[],
  topN: number
): Promise<KnowledgeSearchResult[]> {
  const adapter = getRerankAdapter(runtime.providerId)
  const requestBody = adapter.buildBody({
    modelId: runtime.modelId,
    query,
    documents: searchResults.map((result) => result.pageContent),
    topN
  })
  const url = adapter.buildUrl(runtime.baseUrl)

  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: adapter.buildHeaders(runtime.apiKey),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(RERANK_REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return mergeRerankResults(searchResults, adapter.parseResponse(await response.json()))
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error('Knowledge rerank request failed', normalizedError, {
      providerId: runtime.providerId,
      modelId: runtime.modelId,
      topN
    })
    throw normalizedError
  }
}

export async function rerankKnowledgeSearchResults(
  base: KnowledgeBase,
  query: string,
  searchResults: KnowledgeSearchResult[]
): Promise<KnowledgeSearchResult[]> {
  if (!base.rerankModelId || searchResults.length === 0) {
    return searchResults
  }

  const runtime = await resolveRerankRuntime(base)
  if (!runtime) {
    logger.debug('Skipping knowledge rerank because provider runtime config is unavailable', {
      baseId: base.id,
      rerankModelId: base.rerankModelId
    })
    return searchResults
  }

  return await executeRerankRequest(runtime, query, searchResults, base.documentCount ?? DEFAULT_DOCUMENT_COUNT)
}
