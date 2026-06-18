import { loggerService } from '@logger'
import {
  RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
  serializeRendererPersistCacheValue
} from '@shared/data/cache/cacheSchemas'

import { notifyDataSyncLocalChange } from './DataSyncLocalChangeSignal'
import { getRendererStorageV2Api } from './StorageV2RendererApi'
import { serializeStorageV2MirrorError, type StorageV2RuntimeMirrorStatusEntry } from './StorageV2RuntimeMirrorStatus'
import { unrefTimer } from './StorageV2TimerUtils'

const logger = loggerService.withContext('StorageV2LocalStorageSnapshot')

const MCP_PROVIDER_TOKEN_KEYS = [
  'mcprouter_token',
  'modelscope_token',
  'tokenLanyunToken',
  'tokenflux_token',
  'ai302_token',
  'bailian_token'
] as const

const DURABLE_LOCAL_STORAGE_KEYS = [
  'language',
  'memory_currentUserId',
  'onboarding-completed',
  'privacy-popup-accepted',
  RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY
] as const

const MCP_PROVIDER_TOKEN_KEY_SET = new Set<string>(MCP_PROVIDER_TOKEN_KEYS)
const DURABLE_LOCAL_STORAGE_KEY_SET = new Set<string>(DURABLE_LOCAL_STORAGE_KEYS)
const DEFAULT_LOCAL_STORAGE_MIRROR_DEBOUNCE_MS = 0
const LOCAL_STORAGE_MIRROR_RETRY_MS = 5000
const MCP_PROVIDER_TOKEN_CLEAR_MODE = 'explicit'

let localStorageMirrorTimer: ReturnType<typeof setTimeout> | null = null
let localStorageMirrorRetryTimer: ReturnType<typeof setTimeout> | null = null
let localStorageMirrorInflight: Promise<void> | null = null
let localStorageMirrorNeedsFollowUp = false
let lastLocalStorageMirrorSnapshotJson = ''
let lastLocalStorageMirrorError: unknown = null
let localStorageMirrorSuspended = false
let localStorageMirrorPending = false
const pendingClearedMcpProviderTokenKeys = new Set<string>()

export type StorageV2LocalStorageSnapshot = {
  clearedMcpProviderTokenKeys: string[]
  durableValues: Record<string, string>
  mcpProviderTokenClearMode?: typeof MCP_PROVIDER_TOKEN_CLEAR_MODE
  mcpProviderTokens: Record<string, string>
}

function sanitizeDurableLocalStorageValue(key: string, value: unknown): string | null {
  if (key === RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY) {
    return serializeRendererPersistCacheValue(value)
  }

  return typeof value === 'string' && value ? value : null
}

function safeGetLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetLocalStorageItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Browser storage can be unavailable even when the global exists.
  }
}

function safeRemoveLocalStorageItem(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Browser storage can be unavailable even when the global exists.
  }
}

export function getStorageV2LocalStorageSnapshot(): StorageV2LocalStorageSnapshot {
  const durableValues: Record<string, string> = {}
  const mcpProviderTokens: Record<string, string> = {}

  if (typeof localStorage === 'undefined') {
    return {
      clearedMcpProviderTokenKeys: [],
      durableValues,
      mcpProviderTokenClearMode: MCP_PROVIDER_TOKEN_CLEAR_MODE,
      mcpProviderTokens
    }
  }

  for (const key of DURABLE_LOCAL_STORAGE_KEYS) {
    const value = safeGetLocalStorageItem(key)
    const sanitizedValue = sanitizeDurableLocalStorageValue(key, value)
    if (sanitizedValue) {
      durableValues[key] = sanitizedValue
    }
  }

  for (const key of MCP_PROVIDER_TOKEN_KEYS) {
    const token = safeGetLocalStorageItem(key)
    if (token) {
      mcpProviderTokens[key] = token
    }
  }

  const clearedMcpProviderTokenKeys = MCP_PROVIDER_TOKEN_KEYS.filter(
    (key) => pendingClearedMcpProviderTokenKeys.has(key) && !mcpProviderTokens[key]
  )

  return {
    clearedMcpProviderTokenKeys,
    durableValues,
    mcpProviderTokenClearMode: MCP_PROVIDER_TOKEN_CLEAR_MODE,
    mcpProviderTokens
  }
}

export function applyStorageV2LocalStorageSnapshot(snapshot: Partial<StorageV2LocalStorageSnapshot>) {
  if (typeof localStorage === 'undefined') return

  for (const [key, value] of Object.entries(snapshot.durableValues ?? {})) {
    if (DURABLE_LOCAL_STORAGE_KEY_SET.has(key)) {
      const sanitizedValue = sanitizeDurableLocalStorageValue(key, value)
      if (sanitizedValue) {
        safeSetLocalStorageItem(key, sanitizedValue)
      }
    }
  }

  if (
    snapshot.mcpProviderTokenClearMode === MCP_PROVIDER_TOKEN_CLEAR_MODE &&
    Array.isArray(snapshot.clearedMcpProviderTokenKeys)
  ) {
    for (const key of snapshot.clearedMcpProviderTokenKeys) {
      if (MCP_PROVIDER_TOKEN_KEY_SET.has(key)) {
        safeRemoveLocalStorageItem(key)
      }
    }
  }

  for (const [key, token] of Object.entries(snapshot.mcpProviderTokens ?? {})) {
    if (MCP_PROVIDER_TOKEN_KEY_SET.has(key) && typeof token === 'string' && token) {
      safeSetLocalStorageItem(key, token)
    }
  }
}

export function isStorageV2MirroredLocalStorageKey(key: string) {
  return DURABLE_LOCAL_STORAGE_KEY_SET.has(key) || MCP_PROVIDER_TOKEN_KEY_SET.has(key)
}

export function notifyStorageV2MirroredLocalStorageKeyChanged(
  key: string,
  optionsOrDebounce: { cleared?: boolean } | number = {},
  debounceMs = DEFAULT_LOCAL_STORAGE_MIRROR_DEBOUNCE_MS
) {
  if (!isStorageV2MirroredLocalStorageKey(key)) return

  const options = typeof optionsOrDebounce === 'number' ? {} : optionsOrDebounce
  const resolvedDebounceMs = typeof optionsOrDebounce === 'number' ? optionsOrDebounce : debounceMs

  if (options.cleared && MCP_PROVIDER_TOKEN_KEY_SET.has(key)) {
    pendingClearedMcpProviderTokenKeys.add(key)
  }

  scheduleStorageV2LocalStorageMirror(resolvedDebounceMs)
}

export function scheduleStorageV2LocalStorageMirror(debounceMs = DEFAULT_LOCAL_STORAGE_MIRROR_DEBOUNCE_MS) {
  if (localStorageMirrorSuspended) return
  localStorageMirrorPending = true
  const { hasWindow, api } = getRendererStorageV2Api()
  if (!hasWindow) return
  if (!api) {
    scheduleLocalStorageMirrorRetry()
    return
  }

  clearLocalStorageMirrorRetryTimer()

  if (localStorageMirrorTimer) {
    clearTimeout(localStorageMirrorTimer)
    localStorageMirrorTimer = null
  }

  if (debounceMs <= 0) {
    void flushStorageV2LocalStorageMirror()
    return
  }

  localStorageMirrorTimer = setTimeout(() => {
    localStorageMirrorTimer = null
    void flushStorageV2LocalStorageMirror()
  }, debounceMs)
  unrefTimer(localStorageMirrorTimer)
}

export async function flushStorageV2LocalStorageMirror() {
  if (localStorageMirrorSuspended) return
  const { hasWindow, api } = getRendererStorageV2Api()
  if (!hasWindow) return
  if (!api) {
    if (localStorageMirrorPending) {
      scheduleLocalStorageMirrorRetry()
    }
    return
  }

  clearLocalStorageMirrorRetryTimer()

  if (localStorageMirrorTimer) {
    clearTimeout(localStorageMirrorTimer)
    localStorageMirrorTimer = null
  }

  if (localStorageMirrorInflight) {
    localStorageMirrorNeedsFollowUp = true
    await localStorageMirrorInflight
    if (localStorageMirrorNeedsFollowUp) {
      localStorageMirrorNeedsFollowUp = false
      await flushStorageV2LocalStorageMirror()
    }
    return
  }

  const snapshot = getStorageV2LocalStorageSnapshot()
  const snapshotJson = JSON.stringify(snapshot)
  if (snapshotJson === lastLocalStorageMirrorSnapshotJson) {
    lastLocalStorageMirrorError = null
    localStorageMirrorPending = false
    return
  }

  localStorageMirrorInflight = api
    .importLegacyReduxSnapshot(
      {
        localStorage: snapshot
      },
      { dryRun: false }
    )
    .then(() => {
      lastLocalStorageMirrorSnapshotJson = snapshotJson
      lastLocalStorageMirrorError = null
      localStorageMirrorPending = false
      for (const key of snapshot.clearedMcpProviderTokenKeys) {
        pendingClearedMcpProviderTokenKeys.delete(key)
      }
      notifyDataSyncLocalChange('local-storage')
      logger.debug('Mirrored durable localStorage values to Storage v2')
    })
    .catch((error) => {
      lastLocalStorageMirrorError = error
      localStorageMirrorPending = true
      scheduleLocalStorageMirrorRetry()
      logger.warn('Failed to mirror durable localStorage values to Storage v2', error as Error)
    })
    .finally(() => {
      localStorageMirrorInflight = null
    })

  await localStorageMirrorInflight
}

export async function flushStorageV2LocalStorageMirrorStrict() {
  await flushStorageV2LocalStorageMirror()

  if (localStorageMirrorPending && !getRendererStorageV2Api().api) {
    throw new Error('Storage v2 API unavailable while durable localStorage mirror work is pending')
  }

  if (localStorageMirrorRetryTimer && lastLocalStorageMirrorError) {
    throw lastLocalStorageMirrorError instanceof Error
      ? lastLocalStorageMirrorError
      : new Error('Failed to mirror durable localStorage values to Storage v2')
  }
}

export function suspendStorageV2LocalStorageMirrorUntilReload() {
  localStorageMirrorSuspended = true
  localStorageMirrorNeedsFollowUp = false
  lastLocalStorageMirrorError = null
  localStorageMirrorPending = false

  if (localStorageMirrorTimer) {
    clearTimeout(localStorageMirrorTimer)
    localStorageMirrorTimer = null
  }

  clearLocalStorageMirrorRetryTimer()
}

export function getStorageV2LocalStorageMirrorStatus(): StorageV2RuntimeMirrorStatusEntry {
  const queuedCount =
    localStorageMirrorPending ||
    localStorageMirrorTimer ||
    localStorageMirrorRetryTimer ||
    localStorageMirrorNeedsFollowUp
      ? 1
      : 0

  return {
    id: 'local_storage',
    pendingCount: queuedCount + (localStorageMirrorInflight ? 1 : 0),
    inflight: Boolean(localStorageMirrorInflight),
    suspended: localStorageMirrorSuspended,
    lastError: serializeStorageV2MirrorError(lastLocalStorageMirrorError)
  }
}

function clearLocalStorageMirrorRetryTimer() {
  if (!localStorageMirrorRetryTimer) return

  clearTimeout(localStorageMirrorRetryTimer)
  localStorageMirrorRetryTimer = null
}

function scheduleLocalStorageMirrorRetry() {
  if (localStorageMirrorRetryTimer || typeof window === 'undefined' || localStorageMirrorSuspended) return

  localStorageMirrorRetryTimer = setTimeout(() => {
    localStorageMirrorRetryTimer = null
    void flushStorageV2LocalStorageMirror()
  }, LOCAL_STORAGE_MIRROR_RETRY_MS)
  unrefTimer(localStorageMirrorRetryTimer)
}
