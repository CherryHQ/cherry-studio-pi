import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { WebDavConfig } from '@shared/types/backup'
import { normalizeWebDavConfig } from '@shared/webdavConfig'

const logger = loggerService.withContext('DataSyncService')

const DEFAULT_REMOTE_PATH = '/cherry-studio-pi'
const LOCAL_CHANGE_AUTO_SYNC_DEBOUNCE_MS = 20_000
const RENDERER_SYNC_RECONCILE_GRACE_MS = 60_000
const RENDERER_SYNC_STATUS_TIMEOUT_MS = 30_000
const MAIN_PROCESS_SYNC_TIMEOUT_MS = 15 * 60_000
const AUTO_SYNC_FAILURE_MIN_RETRY_MS = 5 * 60_000
const AUTO_SYNC_FAILURE_MAX_RETRY_MS = 30 * 60_000

export type DataSyncSettings = {
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
  autoSync: boolean
  syncInterval: number
}

export type DataSyncSummary = {
  status?: 'success' | 'failed'
  error?: string | null
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  resolvedConflicts?: number
  skipped: number
  storageUploaded?: number
  storageDownloaded?: number
  storageDeleted?: number
  storageConflicts?: number
  storageResolvedConflicts?: number
  storageSkipped?: number
  blobUploaded?: number
  blobDownloaded?: number
  secretUploaded?: number
  secretDownloaded?: number
  snapshotUploaded?: boolean
  snapshotFileName?: string | null
  snapshotBytes?: number
  joinSafetySnapshotCreated?: boolean
  joinSafetySnapshotFileName?: string | null
  joinSafetySnapshotPath?: string | null
  joinSafetySnapshotBytes?: number
  remotePath?: string | null
  remoteGeneration?: number | null
  remoteManifestHash?: string | null
  syncSpaceId?: string | null
  storageBundleHash?: string | null
  storageRecordCount?: number
  storageBlobCount?: number
  lastSyncAt: number
}

export type DataSyncStatus = {
  deviceId: string
  lastSummary: DataSyncSummary | null
  conflicts: unknown[]
  syncing: boolean
  syncStartedAt?: number | null
}

export type DataSyncRuntimeState = {
  syncing: boolean
  syncStartedAt: number | null
}

type DataSyncSettingsUpdate = Partial<DataSyncSettings>

let syncTimeout: ReturnType<typeof setTimeout> | null = null
let localChangeSyncTimeout: ReturnType<typeof setTimeout> | null = null
let storageV2LocalChangeUnsubscribe: (() => void) | null = null
let externalSyncCompleteUnsubscribe: (() => void) | null = null
let autoSyncStarted = false
let syncing = false
let localChangeDuringSync = false
let syncStartedAt: number | null = null
let autoSyncFailureCount = 0
let autoSyncCooldownUntil = 0

const syncStateListeners = new Set<(state: DataSyncRuntimeState) => void>()

class DataSyncTimeoutError extends Error {
  constructor(
    readonly stageName: string,
    readonly timeoutMs: number
  ) {
    super(
      `数据同步在“${stageName}”阶段超过 ${formatDurationZh(timeoutMs)} 仍未完成。软件会继续向主进程确认同步状态，请稍后刷新最近结果。`
    )
    this.name = 'DataSyncTimeoutError'
  }
}

function defaultSettings(): DataSyncSettings {
  return {
    webdavHost: '',
    webdavUser: '',
    webdavPass: '',
    webdavPath: DEFAULT_REMOTE_PATH,
    autoSync: false,
    syncInterval: 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeDataSyncSettings(value: unknown): DataSyncSettings {
  if (!isRecord(value)) return defaultSettings()

  const legacy = value as {
    dataSyncWebdavHost?: unknown
    dataSyncWebdavUser?: unknown
    dataSyncWebdavPass?: unknown
    dataSyncWebdavPath?: unknown
    dataSyncAutoSync?: unknown
    dataSyncSyncInterval?: unknown
  }

  return {
    webdavHost: normalizeString(value.webdavHost ?? legacy.dataSyncWebdavHost),
    webdavUser: normalizeString(value.webdavUser ?? legacy.dataSyncWebdavUser),
    webdavPass: normalizeString(value.webdavPass ?? legacy.dataSyncWebdavPass),
    webdavPath:
      normalizeString(value.webdavPath ?? legacy.dataSyncWebdavPath, DEFAULT_REMOTE_PATH) || DEFAULT_REMOTE_PATH,
    autoSync: normalizeBoolean(value.autoSync ?? legacy.dataSyncAutoSync),
    syncInterval: normalizeNumber(value.syncInterval ?? legacy.dataSyncSyncInterval)
  }
}

function getDataSyncErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (isRecord(error)) {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
    const nested = error.error
    if (isRecord(nested) && typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message.trim()
    }
  }
  return i18n.t('error.unknown')
}

function formatDurationZh(durationMs: number) {
  const totalSeconds = Math.max(Math.ceil(durationMs / 1000), 1)
  if (totalSeconds < 60) return `${totalSeconds} 秒`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}

function isDataSyncAlreadyRunningMessage(message: string) {
  return /Data sync is already running|已有数据同步正在进行|同步正在进行/i.test(message)
}

function makeWebDavConfig(settings: DataSyncSettings): WebDavConfig {
  return {
    webdavHost: settings.webdavHost,
    webdavUser: settings.webdavUser,
    webdavPass: settings.webdavPass,
    webdavPath: settings.webdavPath
  }
}

async function withDataSyncTimeout<T>(stageName: string, operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new DataSyncTimeoutError(stageName, timeoutMs))
    }, timeoutMs)
    unrefTimer(timeout)
  })

  try {
    return await Promise.race([operation(), timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function rememberDataSyncFailure(message: string) {
  try {
    await window.api.dataSync.recordFailure(message)
  } catch (error) {
    logger.warn('Failed to record renderer data sync failure summary', error as Error)
  }
}

function getDataSyncRuntimeState(): DataSyncRuntimeState {
  return {
    syncing,
    syncStartedAt
  }
}

function notifyDataSyncRuntimeStateListener(
  listener: (state: DataSyncRuntimeState) => void,
  state: DataSyncRuntimeState
) {
  try {
    listener(state)
  } catch (error) {
    logger.warn('Data sync runtime state listener failed', error as Error)
  }
}

function setDataSyncRunning(nextSyncing: boolean, nextStartedAt?: number | null) {
  const previousState = getDataSyncRuntimeState()
  syncing = nextSyncing
  syncStartedAt = nextSyncing ? (nextStartedAt ?? syncStartedAt ?? Date.now()) : null
  const nextState = getDataSyncRuntimeState()
  if (previousState.syncing === nextState.syncing && previousState.syncStartedAt === nextState.syncStartedAt) return

  for (const listener of syncStateListeners) {
    notifyDataSyncRuntimeStateListener(listener, nextState)
  }
}

async function getMainProcessDataSyncStatus() {
  return window.api.dataSync.getStatus().catch((error) => {
    logger.warn('Failed to inspect main-process data sync status', error as Error)
    return null
  }) as Promise<DataSyncStatus | null>
}

async function reconcileRendererSyncStateWithMainProcess() {
  const status = await getMainProcessDataSyncStatus()
  const mainProcessRunning = Boolean(status?.syncing)
  if (mainProcessRunning) {
    setDataSyncRunning(true, typeof status?.syncStartedAt === 'number' ? status.syncStartedAt : null)
    return true
  }

  if (
    syncing &&
    !mainProcessRunning &&
    syncStartedAt !== null &&
    Date.now() - syncStartedAt > RENDERER_SYNC_RECONCILE_GRACE_MS
  ) {
    logger.warn('Clearing stale renderer data sync runtime state because the main process is idle', {
      syncStartedAt
    })
    setDataSyncRunning(false)
  }

  return mainProcessRunning
}

async function reconcileRendererSyncStateWithMainProcessWithTimeout(stageName: string) {
  return withDataSyncTimeout(
    stageName,
    () => reconcileRendererSyncStateWithMainProcess(),
    RENDERER_SYNC_STATUS_TIMEOUT_MS
  )
}

function clearLocalChangeSyncTimeout() {
  if (!localChangeSyncTimeout) return

  clearTimeout(localChangeSyncTimeout)
  localChangeSyncTimeout = null
}

function getAutoSyncCooldownRemainingMs(now = Date.now()) {
  return Math.max(autoSyncCooldownUntil - now, 0)
}

function getAutoSyncFailureRetryDelayMs(intervalMs: number) {
  const exponentialDelay = AUTO_SYNC_FAILURE_MIN_RETRY_MS * 2 ** Math.max(autoSyncFailureCount - 1, 0)
  return Math.max(intervalMs, Math.min(exponentialDelay, AUTO_SYNC_FAILURE_MAX_RETRY_MS))
}

function resetAutoSyncFailureBackoff() {
  autoSyncFailureCount = 0
  autoSyncCooldownUntil = 0
}

async function getAutoSyncIntervalMs() {
  const settings = await readDataSyncSettings()
  if (
    !settings.autoSync ||
    !settings.webdavHost ||
    !settings.webdavUser ||
    !settings.webdavPass ||
    settings.syncInterval <= 0
  ) {
    return null
  }

  return settings.syncInterval * 60 * 1000
}

function scheduleLocalChangeSync(delayMs = LOCAL_CHANGE_AUTO_SYNC_DEBOUNCE_MS) {
  if (!autoSyncStarted) return

  const cooldownRemainingMs = getAutoSyncCooldownRemainingMs()
  if (cooldownRemainingMs > delayMs && syncTimeout) {
    logger.info('Local change sync deferred to existing auto sync failure retry', {
      cooldownRemainingMs,
      autoSyncFailureCount
    })
    return
  }

  const effectiveDelayMs = Math.max(delayMs, cooldownRemainingMs)
  clearLocalChangeSyncTimeout()
  localChangeSyncTimeout = setTimeout(() => {
    localChangeSyncTimeout = null
    void performAutoSync()
  }, effectiveDelayMs)
  unrefTimer(localChangeSyncTimeout)

  logger.info('Data sync scheduled after local Storage v2 change', {
    delayMs: effectiveDelayMs,
    requestedDelayMs: delayMs,
    autoSyncFailureCount
  })
}

function ensureMainProcessStorageV2ChangeSubscription() {
  if (storageV2LocalChangeUnsubscribe) return

  const subscribe = window.api?.dataSync?.onLocalStorageV2Changed
  if (typeof subscribe !== 'function') return

  storageV2LocalChangeUnsubscribe = subscribe(() => {
    if (!autoSyncStarted) return

    if (syncing) {
      localChangeDuringSync = true
      logger.debug('Queued data sync after current sync because Storage v2 changed')
      return
    }

    scheduleLocalChangeSync()
  })
}

function continueMainSyncAfterRendererTimeout(syncPromise: Promise<DataSyncSummary>) {
  void syncPromise
    .catch(async (error) => {
      const message = getDataSyncErrorMessage(error)
      logger.warn('Main-process data sync finished with an error after renderer IPC timeout', error as Error)
      await rememberDataSyncFailure(message)
    })
    .finally(() => {
      void reconcileRendererSyncStateWithMainProcessWithTimeout('刷新延迟同步完成状态').catch((error) => {
        logger.warn('Failed to reconcile data sync runtime state after delayed sync completion', error as Error)
      })
      if (localChangeDuringSync) {
        localChangeDuringSync = false
        scheduleLocalChangeSync()
      }
    })
}

function scheduleNextSync(delayMs: number) {
  if (syncTimeout) clearTimeout(syncTimeout)

  const effectiveDelayMs = Math.max(delayMs, getAutoSyncCooldownRemainingMs())
  syncTimeout = setTimeout(() => {
    void performAutoSync()
  }, effectiveDelayMs)
  unrefTimer(syncTimeout)

  logger.info('Data sync scheduled', {
    delayMs: effectiveDelayMs,
    requestedDelayMs: delayMs,
    autoSyncFailureCount
  })
}

async function performAutoSync() {
  const intervalMs = await getAutoSyncIntervalMs()
  if (intervalMs === null) {
    stopDataSyncAutoSync()
    return
  }

  const cooldownRemainingMs = getAutoSyncCooldownRemainingMs()
  if (cooldownRemainingMs > 0) {
    logger.info('Skipping auto data sync during failure backoff', {
      cooldownRemainingMs,
      autoSyncFailureCount
    })
    scheduleNextSync(cooldownRemainingMs)
    return
  }

  try {
    const summary = await syncAppDataNow()
    if (summary) {
      resetAutoSyncFailureBackoff()
    }
  } catch (error) {
    autoSyncFailureCount += 1
    const retryDelayMs = getAutoSyncFailureRetryDelayMs(intervalMs)
    autoSyncCooldownUntil = Date.now() + retryDelayMs
    logger.warn('Auto data sync failed; backing off before next retry', error as Error, {
      autoSyncFailureCount,
      retryDelayMs
    })
  } finally {
    if (!autoSyncStarted) return

    const nextIntervalMs = await getAutoSyncIntervalMs()
    if (nextIntervalMs === null) {
      stopDataSyncAutoSync()
    } else {
      scheduleNextSync(nextIntervalMs)
    }
  }
}

export function subscribeDataSyncRuntimeState(listener: (state: DataSyncRuntimeState) => void) {
  syncStateListeners.add(listener)
  notifyDataSyncRuntimeStateListener(listener, getDataSyncRuntimeState())

  return () => {
    syncStateListeners.delete(listener)
  }
}

export async function refreshDataSyncRuntimeStateFromMain(): Promise<DataSyncRuntimeState> {
  await reconcileRendererSyncStateWithMainProcessWithTimeout('刷新主进程同步状态')
  return getDataSyncRuntimeState()
}

export async function readDataSyncSettings(): Promise<DataSyncSettings> {
  return normalizeDataSyncSettings(await window.api.dataSync.getConfig())
}

export async function writeDataSyncSettings(update: DataSyncSettingsUpdate): Promise<DataSyncSettings> {
  const current = await readDataSyncSettings()
  return normalizeDataSyncSettings(
    await window.api.dataSync.setConfig({
      ...current,
      ...update
    })
  )
}

export async function syncAppDataNow(configOverride?: WebDavConfig): Promise<DataSyncSummary | null> {
  if (syncing) {
    await reconcileRendererSyncStateWithMainProcessWithTimeout('检查当前同步状态').catch((error) => {
      logger.warn('Failed to reconcile renderer data sync state before starting another sync', error as Error)
      setDataSyncRunning(false)
      throw error
    })

    if (syncing) {
      logger.info('Data sync already running')
      return null
    }
  }

  const settings = configOverride ? null : await readDataSyncSettings()
  const config = normalizeWebDavConfig(configOverride ?? makeWebDavConfig(settings!), {
    defaultPath: DEFAULT_REMOTE_PATH,
    requireCredentials: true
  })
  if (!config.webdavHost) {
    throw new Error(i18n.t('settings.data.data_sync.toast.webdav_required'))
  }

  if (await reconcileRendererSyncStateWithMainProcessWithTimeout('检查主进程同步状态')) {
    logger.info('Data sync already running in main process')
    return null
  }

  const rendererSyncStartedAt = Date.now()
  setDataSyncRunning(true, rendererSyncStartedAt)
  clearLocalChangeSyncTimeout()
  let mainSyncPromise: Promise<DataSyncSummary> | null = null
  let keepRendererSyncingAfterReturn = false

  try {
    mainSyncPromise = window.api.dataSync.syncNow(config)
    return await withDataSyncTimeout(
      '执行 WebDAV 同步',
      () => mainSyncPromise as Promise<DataSyncSummary>,
      MAIN_PROCESS_SYNC_TIMEOUT_MS
    )
  } catch (error) {
    const message = getDataSyncErrorMessage(error)
    if (isDataSyncAlreadyRunningMessage(message)) {
      logger.info('Data sync already running in main process')
      await reconcileRendererSyncStateWithMainProcessWithTimeout('刷新已有同步状态').catch((reconcileError) => {
        logger.warn(
          'Failed to reconcile renderer data sync state after already-running response',
          reconcileError as Error
        )
      })
      return null
    }

    if (error instanceof DataSyncTimeoutError && mainSyncPromise) {
      const status = await getMainProcessDataSyncStatus().catch(() => null)
      if (status?.syncing) {
        setDataSyncRunning(true, typeof status.syncStartedAt === 'number' ? status.syncStartedAt : null)
        continueMainSyncAfterRendererTimeout(mainSyncPromise)
        keepRendererSyncingAfterReturn = true
        return null
      }
    }

    await rememberDataSyncFailure(message)
    if (error instanceof Error) throw error
    throw new Error(message, { cause: error })
  } finally {
    if (!keepRendererSyncingAfterReturn) {
      setDataSyncRunning(false)
    }
    await reconcileRendererSyncStateWithMainProcessWithTimeout('同步结束后刷新主进程状态').catch((error) => {
      logger.warn('Failed to reconcile data sync runtime state after sync completion', error as Error)
    })
    if (localChangeDuringSync) {
      localChangeDuringSync = false
      scheduleLocalChangeSync()
    }
  }
}

export function startDataSyncExternalSyncListener() {
  if (externalSyncCompleteUnsubscribe) return

  const subscribe = window.api?.dataSync?.onExternalSyncCompleted
  if (typeof subscribe !== 'function') return

  externalSyncCompleteUnsubscribe = subscribe((payload: unknown) => {
    void refreshDataSyncRuntimeStateFromMain().catch((error) => {
      logger.warn('Failed to refresh data sync state after external sync completion', error as Error)
    })
    window.dispatchEvent(new CustomEvent('cherry-studio-pi:data-sync-external-completed', { detail: payload }))
  })
}

export function stopDataSyncExternalSyncListener() {
  if (!externalSyncCompleteUnsubscribe) return

  externalSyncCompleteUnsubscribe()
  externalSyncCompleteUnsubscribe = null
}

export function stopDataSyncAutoSync() {
  autoSyncStarted = false
  localChangeDuringSync = false
  resetAutoSyncFailureBackoff()
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  clearLocalChangeSyncTimeout()
  if (storageV2LocalChangeUnsubscribe) {
    storageV2LocalChangeUnsubscribe()
    storageV2LocalChangeUnsubscribe = null
  }
}

export async function startDataSyncAutoSync(immediate = false) {
  const intervalMs = await getAutoSyncIntervalMs()
  if (intervalMs === null) {
    stopDataSyncAutoSync()
    return
  }

  ensureMainProcessStorageV2ChangeSubscription()

  if (autoSyncStarted && syncTimeout && !immediate) {
    return
  }

  autoSyncStarted = true
  scheduleNextSync(immediate ? 1000 : intervalMs)
}
