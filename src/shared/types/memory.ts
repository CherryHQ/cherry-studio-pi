import type { Model } from '@shared/data/types/model'

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export interface MemoryConfig {
  embeddingDimensions?: number
  embeddingModel?: Model | Record<string, unknown>
  llmModel?: Model | Record<string, unknown>
  embeddingApiClient?: {
    model: string
    provider: string
    apiKey: string
    apiVersion?: string
    baseURL: string
  }
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  isAutoDimensions?: boolean
}

export interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}

export interface MemoryEntity {
  userId?: string
  agentId?: string
  runId?: string
}

export interface MemorySearchFilters {
  userId?: string
  agentId?: string
  runId?: string
  [key: string]: any
}

export interface AddMemoryOptions extends MemoryEntity {
  metadata?: Record<string, any>
  filters?: MemorySearchFilters
  infer?: boolean
}

export interface MemorySearchOptions extends MemoryEntity {
  limit?: number
  filters?: MemorySearchFilters
}

export interface MemoryHistoryItem {
  id: number
  memoryId: string
  previousValue?: string
  newValue: string
  action: 'ADD' | 'UPDATE' | 'DELETE'
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface MemoryListOptions extends MemoryEntity {
  limit?: number
  offset?: number
}
