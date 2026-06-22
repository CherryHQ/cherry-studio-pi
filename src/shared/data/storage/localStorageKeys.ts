import { RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY } from '@shared/data/cache/cacheSchemas'

export const STORAGE_V2_MCP_PROVIDER_TOKEN_KEYS = [
  'mcprouter_token',
  'modelscope_token',
  'tokenLanyunToken',
  'tokenflux_token',
  'ai302_token',
  'bailian_token'
] as const

export type StorageV2McpProviderTokenKey = (typeof STORAGE_V2_MCP_PROVIDER_TOKEN_KEYS)[number]

export const STORAGE_V2_DURABLE_LOCAL_STORAGE_KEYS = [
  'language',
  'memory_currentUserId',
  'onboarding-completed',
  'privacy-popup-accepted',
  RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY
] as const

export type StorageV2DurableLocalStorageKey = (typeof STORAGE_V2_DURABLE_LOCAL_STORAGE_KEYS)[number]
