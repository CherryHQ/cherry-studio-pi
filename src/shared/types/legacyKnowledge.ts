export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type LegacyKnowledgeModel = {
  id: string
  provider: string
  name?: string
  group?: string
  [key: string]: unknown
}

export type LegacyKnowledgeApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory' | 'memory' | 'video'

export type KnowledgeItem = {
  id: string
  baseId?: string
  uniqueId?: string
  uniqueIds?: string[]
  type: KnowledgeItemType
  content: unknown
  remark?: string
  created_at: number
  updated_at: number
  processingStatus?: ProcessingStatus
  processingProgress?: number
  processingError?: string
  retryCount?: number
  isPreprocessed?: boolean
}

export interface PreprocessProvider {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  model?: string
  options?: any
}

export interface KnowledgeBase {
  id: string
  name: string
  model: LegacyKnowledgeModel
  dimensions?: number
  description?: string
  items: KnowledgeItem[]
  created_at: number
  updated_at: number
  version: number
  documentCount?: number
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  rerankModel?: LegacyKnowledgeModel
  preprocessProvider?: {
    type: 'preprocess'
    provider: PreprocessProvider
  }
}

export type KnowledgeBaseParams = {
  id: string
  dimensions?: number
  chunkSize?: number
  chunkOverlap?: number
  embedApiClient: LegacyKnowledgeApiClient
  rerankApiClient?: LegacyKnowledgeApiClient
  documentCount?: number
  preprocessProvider?: {
    type: 'preprocess'
    provider: PreprocessProvider
  }
}
