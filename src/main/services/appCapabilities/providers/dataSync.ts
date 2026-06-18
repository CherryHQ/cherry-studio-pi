import { loggerService } from '@logger'
import { appDataSyncService } from '@main/services/appData/AppDataSyncService'
import { storageV2SecretVaultService } from '@main/services/storageV2/SecretVaultService'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import { describeWebDavUserFacingError } from '@main/services/WebDavRetry'
import {
  type DataSyncBridgeSettings,
  type DataSyncBridgeSettingsUpdate,
  RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE,
  RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
  RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE
} from '@shared/dataSyncBridge'
import { IpcChannel } from '@shared/IpcChannel'
import { normalizeWebDavConfig } from '@shared/webdavConfig'
import type { WebDavConfig } from '@types'
import { BrowserWindow } from 'electron'

import { callRendererBridge, getBridgeErrorMessage } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapability:DataSync')
const DEFAULT_DATA_SYNC_PATH = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'
const RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS = 5 * 60_000

type DataSyncSettingsState = {
  dataSyncWebdavHost?: string
  dataSyncWebdavUser?: string
  dataSyncWebdavPass?: string
  dataSyncWebdavPath?: string
  dataSyncAutoSync?: boolean
  dataSyncSyncInterval?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeStoredString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeStoredBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStoredNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

async function resolveStoredSecret(value: unknown) {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''

  const secretRef = value.secretRef
  if (!isNonEmptyString(secretRef)) return ''

  return (await storageV2SecretVaultService.getSecret(secretRef)) ?? ''
}

async function getStorageV2DataSyncSettings(): Promise<{
  settings: DataSyncSettingsState
  hasConfiguredValue: boolean
}> {
  const [webdavHost, webdavUser, webdavPass, webdavPath, dataSyncAutoSync, dataSyncSyncInterval] = await Promise.all([
    storageV2Service.getSetting('settings.dataSyncWebdavHost'),
    storageV2Service.getSetting('settings.dataSyncWebdavUser'),
    storageV2Service.getSetting('settings.dataSyncWebdavPass'),
    storageV2Service.getSetting('settings.dataSyncWebdavPath'),
    storageV2Service.getSetting('settings.dataSyncAutoSync'),
    storageV2Service.getSetting('settings.dataSyncSyncInterval')
  ])

  const settings = {
    dataSyncWebdavHost: normalizeStoredString(webdavHost),
    dataSyncWebdavUser: normalizeStoredString(webdavUser),
    dataSyncWebdavPass: await resolveStoredSecret(webdavPass),
    dataSyncWebdavPath: normalizeStoredString(webdavPath, DEFAULT_DATA_SYNC_PATH),
    dataSyncAutoSync: normalizeStoredBoolean(dataSyncAutoSync),
    dataSyncSyncInterval: normalizeStoredNumber(dataSyncSyncInterval)
  }

  return {
    settings,
    hasConfiguredValue: Boolean(
      settings.dataSyncWebdavHost ||
        settings.dataSyncWebdavUser ||
        settings.dataSyncWebdavPass ||
        (settings.dataSyncWebdavPath && settings.dataSyncWebdavPath !== DEFAULT_DATA_SYNC_PATH) ||
        settings.dataSyncAutoSync ||
        settings.dataSyncSyncInterval
    )
  }
}

async function getDataSyncSettings(): Promise<DataSyncSettingsState> {
  let storageSettings: Awaited<ReturnType<typeof getStorageV2DataSyncSettings>> = {
    settings: {
      dataSyncWebdavHost: '',
      dataSyncWebdavUser: '',
      dataSyncWebdavPass: '',
      dataSyncWebdavPath: DEFAULT_DATA_SYNC_PATH,
      dataSyncAutoSync: false,
      dataSyncSyncInterval: 0
    },
    hasConfiguredValue: false
  }

  try {
    storageSettings = await getStorageV2DataSyncSettings()
    if (storageSettings.hasConfiguredValue) {
      return storageSettings.settings
    }
  } catch (error) {
    logger.warn('Failed to read data sync settings from Storage v2; falling back to renderer settings bridge', {
      error: getBridgeErrorMessage(error)
    })
  }

  try {
    return await callRendererBridge<DataSyncBridgeSettings>(RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE, undefined, {
      timeoutMessage: 'Timed out reading data sync settings'
    })
  } catch (error) {
    logger.warn('Failed to read data sync settings from renderer; using Storage v2 fallback', {
      error: getBridgeErrorMessage(error)
    })
    return storageSettings.settings
  }
}

async function getStoredWebDavConfig(): Promise<WebDavConfig> {
  const settings = await getDataSyncSettings()
  return {
    webdavHost: settings.dataSyncWebdavHost ?? '',
    webdavUser: settings.dataSyncWebdavUser ?? '',
    webdavPass: settings.dataSyncWebdavPass ?? '',
    webdavPath: settings.dataSyncWebdavPath || DEFAULT_DATA_SYNC_PATH
  }
}

function hasOwnInput(input: any, key: string) {
  return Object.prototype.hasOwnProperty.call(input ?? {}, key)
}

function normalizeInputText(value: unknown, fallback = '', options: { trim?: boolean } = {}) {
  const trim = options.trim ?? true
  if (value === null || typeof value === 'undefined') return fallback
  if (typeof value === 'string') return trim ? value.trim() : value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const text = String(value)
    return trim ? text.trim() : text
  }
  return ''
}

function resolveInputText(input: any, key: keyof WebDavConfig, fallback = '') {
  return hasOwnInput(input, key) ? normalizeInputText(input?.[key], fallback, { trim: key !== 'webdavPass' }) : fallback
}

async function resolveWebDavConfig(
  input: any,
  options: {
    requireCredentials?: boolean
  } = {}
): Promise<WebDavConfig> {
  const needsStoredConfig = (['webdavHost', 'webdavUser', 'webdavPass', 'webdavPath'] as const).some(
    (key) => !hasOwnInput(input, key)
  )
  const stored = needsStoredConfig
    ? await getStoredWebDavConfig()
    : {
        webdavHost: '',
        webdavUser: '',
        webdavPass: '',
        webdavPath: DEFAULT_DATA_SYNC_PATH
      }
  return normalizeWebDavConfig(
    {
      webdavHost: resolveInputText(input, 'webdavHost', stored.webdavHost),
      webdavUser: resolveInputText(input, 'webdavUser', stored.webdavUser),
      webdavPass: resolveInputText(input, 'webdavPass', stored.webdavPass),
      webdavPath: resolveInputText(input, 'webdavPath', stored.webdavPath)
    },
    { defaultPath: DEFAULT_DATA_SYNC_PATH, requireCredentials: options.requireCredentials }
  )
}

function hasWebDavHost(config: WebDavConfig) {
  return Boolean(config.webdavHost?.trim())
}

function normalizeRemotePath(value?: string) {
  const trimmed = value?.trim() || DEFAULT_DATA_SYNC_PATH
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, '')
  return normalized === DATA_SYNC_SUFFIX || normalized.endsWith(DATA_SYNC_SUFFIX)
    ? normalized
    : `${normalized === '/' ? '' : normalized}${DATA_SYNC_SUFFIX}`
}

function normalizeDirectoryPath(value: unknown, fallback = '/') {
  const trimmed = normalizeInputText(value, fallback) || fallback
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, '')
  return normalized || '/'
}

function normalizeSyncIntervalInput(value: unknown) {
  if (typeof value === 'undefined') return undefined
  const parsed = typeof value === 'string' && !value.trim() ? undefined : Number(value)
  if (typeof parsed === 'undefined') return undefined
  if (!Number.isFinite(parsed)) throw new Error('Sync interval must be a finite number of minutes')
  const interval = Math.trunc(parsed)
  if (interval < 0) throw new Error('Sync interval cannot be negative')
  return interval
}

async function runWebDavCapability<T>(
  action: string,
  fn: () => Promise<T>,
  options: { recordDataSyncFailure?: boolean } = {}
) {
  try {
    return await fn()
  } catch (error) {
    const message = describeWebDavUserFacingError(error, action)
    if (options.recordDataSyncFailure) {
      await Promise.resolve(appDataSyncService.recordSyncFailure(new Error(message))).catch(() => undefined)
    }
    throw new Error(message)
  }
}

async function prepareRendererStorageV2ForDataSync() {
  try {
    await callRendererBridge<void>(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE, undefined, {
      timeoutMs: RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS,
      timeoutMessage: 'Timed out preparing local data before sync'
    })
  } catch (error) {
    logger.warn('Renderer Storage v2 preparation bridge is unavailable; continuing with persisted Storage v2 data', {
      error: getBridgeErrorMessage(error)
    })
  }
}

async function persistWebDavConfigToStorageV2(
  config: WebDavConfig,
  options: { autoSync?: boolean; syncInterval?: number } = {}
) {
  const secretValue = config.webdavPass || ''
  const secretSettingValue = secretValue
    ? {
        secretRef: await storageV2SecretVaultService.setSecret(
          'settings',
          'dataSyncWebdavPass',
          'dataSyncWebdavPassword',
          secretValue
        )
      }
    : ''

  const entries: Array<[key: string, value: unknown]> = [
    ['settings.dataSyncWebdavHost', config.webdavHost || ''],
    ['settings.dataSyncWebdavUser', config.webdavUser || ''],
    ['settings.dataSyncWebdavPass', secretSettingValue],
    ['settings.dataSyncWebdavPath', config.webdavPath || DEFAULT_DATA_SYNC_PATH]
  ]

  if (typeof options.syncInterval === 'number') {
    entries.push(['settings.dataSyncSyncInterval', options.syncInterval])
  }
  if (typeof options.autoSync === 'boolean') {
    entries.push(['settings.dataSyncAutoSync', options.autoSync])
  }

  for (const [key, value] of entries) {
    await storageV2Service.setSetting(key, value, 'settings')
  }
}

async function persistWebDavConfig(config: WebDavConfig, options: { autoSync?: boolean; syncInterval?: number } = {}) {
  const settings: DataSyncBridgeSettingsUpdate = {
    dataSyncWebdavHost: config.webdavHost || '',
    dataSyncWebdavUser: config.webdavUser || '',
    dataSyncWebdavPass: config.webdavPass || '',
    dataSyncWebdavPath: config.webdavPath || DEFAULT_DATA_SYNC_PATH
  }
  if (typeof options.syncInterval === 'number') {
    settings.dataSyncSyncInterval = options.syncInterval
  }
  if (typeof options.autoSync === 'boolean') {
    settings.dataSyncAutoSync = options.autoSync
  }

  await persistWebDavConfigToStorageV2(config, options)

  try {
    await callRendererBridge<DataSyncBridgeSettings>(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE, settings, {
      timeoutMessage: 'Timed out saving data sync settings'
    })
  } catch (error) {
    logger.warn('Saved data sync settings to Storage v2, but renderer settings refresh failed', {
      error: getBridgeErrorMessage(error)
    })
  }
}

function broadcastExternalDataSyncCompleted(summary: unknown, source: string) {
  const payload = {
    completedAt: Date.now(),
    source,
    summary
  }

  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed?.()) {
      continue
    }
    try {
      browserWindow.webContents.send(IpcChannel.DataSync_ExternalSyncCompleted, payload)
    } catch {
      // UI refresh notification is best-effort; the completed sync result must
      // not be turned into a failure by a closing renderer window.
    }
  }
}

export function createDataSyncCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'dataSync.status.get',
      domain: 'dataSync',
      kind: 'query',
      title: 'Get data sync status',
      description: 'Read the current data sync device id, last sync summary, and unresolved conflicts.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['dataSync', 'sync', 'webdav', 'status'],
      execute: async () => okResult('Data sync status read', sanitizeForAgent(await appDataSyncService.getStatus()))
    },
    {
      id: 'dataSync.webdav.config.get',
      domain: 'dataSync',
      kind: 'query',
      title: 'Get WebDAV sync config',
      description: 'Read the configured WebDAV data sync settings with secrets redacted.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['dataSync', 'sync', 'webdav', 'settings'],
      execute: async () => {
        const settings = await getDataSyncSettings()
        return okResult(
          'WebDAV sync config read',
          sanitizeForAgent({
            webdavHost: settings.dataSyncWebdavHost ?? '',
            webdavUser: settings.dataSyncWebdavUser ?? '',
            webdavPass: settings.dataSyncWebdavPass ?? '',
            webdavPath: settings.dataSyncWebdavPath || DEFAULT_DATA_SYNC_PATH,
            autoSync: settings.dataSyncAutoSync === true,
            syncInterval: settings.dataSyncSyncInterval ?? 0
          })
        )
      }
    },
    {
      id: 'dataSync.webdav.config.set',
      domain: 'dataSync',
      kind: 'command',
      title: 'Configure WebDAV data sync',
      description: 'Save WebDAV data sync configuration. Secrets are stored through the app settings flow.',
      inputSchema: {
        type: 'object',
        properties: {
          webdavHost: { type: 'string', description: 'WebDAV server URL' },
          webdavUser: { type: 'string', description: 'WebDAV username' },
          webdavPass: { type: 'string', description: 'WebDAV password or app password' },
          webdavPath: { type: 'string', description: 'Remote sync directory, for example /cherry-studio-pi' },
          autoSync: { type: 'boolean', description: 'Whether to enable automatic sync' },
          syncInterval: { type: 'number', description: 'Automatic sync interval in minutes' }
        },
        required: ['webdavHost']
      },
      risk: 'write',
      permissions: ['dataSync.settings.write'],
      sideEffects: ['settings.write'],
      supportsDryRun: true,
      tags: ['dataSync', 'sync', 'webdav', 'configure', 'settings'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input, { requireCredentials: true })
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        if (context.dryRun) {
          return okResult('WebDAV data sync config dry run completed', sanitizeForAgent(config))
        }

        const syncInterval = normalizeSyncIntervalInput(input?.syncInterval)
        await persistWebDavConfig(config, {
          autoSync: typeof input?.autoSync === 'boolean' ? input.autoSync : undefined,
          syncInterval
        })
        return okResult('WebDAV data sync config saved', sanitizeForAgent(config))
      }
    },
    {
      id: 'dataSync.webdav.directories.list',
      domain: 'dataSync',
      kind: 'query',
      title: 'List WebDAV directories',
      description: 'List remote WebDAV directories so an agent or UI can choose the correct sync path.',
      inputSchema: {
        type: 'object',
        properties: {
          remotePath: { type: 'string', description: 'Remote directory to list, defaults to /' },
          webdavHost: { type: 'string' },
          webdavUser: { type: 'string' },
          webdavPass: { type: 'string' },
          webdavPath: { type: 'string' }
        }
      },
      risk: 'read',
      permissions: ['network.webdav.read'],
      sideEffects: ['network.webdav.read'],
      tags: ['dataSync', 'sync', 'webdav', 'directories', 'path'],
      execute: async (input: any) => {
        const config = await resolveWebDavConfig(input, { requireCredentials: true })
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        const remotePath = normalizeDirectoryPath(input?.remotePath)
        return okResult(
          'WebDAV directories listed',
          sanitizeForAgent(
            await runWebDavCapability('读取远程目录', () =>
              appDataSyncService.listRemoteDirectories(config, remotePath)
            )
          )
        )
      }
    },
    {
      id: 'dataSync.webdav.diagnose',
      domain: 'dataSync',
      kind: 'query',
      title: 'Diagnose WebDAV data sync',
      description: 'Diagnose WebDAV data sync by checking config, status, remote directory access, and write access.',
      inputSchema: {
        type: 'object',
        properties: {
          remotePath: { type: 'string', description: 'Remote directory to check, defaults to configured path or /' },
          webdavHost: { type: 'string' },
          webdavUser: { type: 'string' },
          webdavPass: { type: 'string' },
          webdavPath: { type: 'string' }
        }
      },
      risk: 'write',
      permissions: ['network.webdav.read', 'network.webdav.write'],
      sideEffects: ['network.webdav.read', 'network.webdav.write'],
      supportsDryRun: true,
      tags: ['dataSync', 'sync', 'webdav', 'diagnose', 'troubleshoot', 'write-access'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input, { requireCredentials: true })
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        const remotePath = normalizeDirectoryPath(input?.remotePath, config.webdavPath || '/')

        const [status, directories, writeAccess] = await runWebDavCapability('诊断 WebDAV 同步', async () => {
          const [nextStatus, nextDirectories] = await Promise.all([
            appDataSyncService.getStatus(),
            appDataSyncService.listRemoteDirectories(config, remotePath)
          ])
          const nextWriteAccess = context.dryRun ? null : await appDataSyncService.checkWriteAccess(config)
          return [nextStatus, nextDirectories, nextWriteAccess] as const
        })
        return okResult(
          'WebDAV data sync diagnosis completed',
          sanitizeForAgent({
            config,
            effectiveSyncPath: normalizeRemotePath(config.webdavPath),
            writeAccess,
            status,
            directories
          })
        )
      }
    },
    {
      id: 'dataSync.sync.now',
      domain: 'dataSync',
      kind: 'command',
      title: 'Sync data now',
      description: 'Run record-level Storage v2 data sync through WebDAV.',
      inputSchema: {
        type: 'object',
        properties: {
          webdavHost: { type: 'string' },
          webdavUser: { type: 'string' },
          webdavPass: { type: 'string' },
          webdavPath: { type: 'string' },
          saveConfig: { type: 'boolean', description: 'Persist provided WebDAV config before syncing' }
        }
      },
      risk: 'write',
      permissions: ['dataSync.write', 'network.webdav.write'],
      sideEffects: ['database.write', 'network.webdav.write', 'filesystem.write'],
      supportsDryRun: true,
      tags: ['dataSync', 'sync', 'webdav', 'run'],
      examples: ['Sync my data now', 'Run WebDAV data sync'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input, { requireCredentials: true })
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        if (context.dryRun) {
          return okResult('Data sync dry run completed', sanitizeForAgent({ config }))
        }

        if (input?.saveConfig === true) {
          await persistWebDavConfig(config)
        }
        await prepareRendererStorageV2ForDataSync()
        const summary = await runWebDavCapability('同步数据', () => appDataSyncService.syncNow(config), {
          recordDataSyncFailure: true
        })
        broadcastExternalDataSyncCompleted(summary, context.source)
        return okResult('Data sync completed', sanitizeForAgent(summary))
      }
    },
    {
      id: 'dataSync.snapshot.restoreLatest',
      domain: 'dataSync',
      kind: 'command',
      title: 'Restore latest data sync snapshot',
      description: 'Restore the latest WebDAV safety snapshot. This replaces local data and restarts the app.',
      inputSchema: {
        type: 'object',
        properties: {
          webdavHost: { type: 'string' },
          webdavUser: { type: 'string' },
          webdavPass: { type: 'string' },
          webdavPath: { type: 'string' }
        }
      },
      risk: 'destructive',
      permissions: ['dataSync.restore'],
      sideEffects: ['database.write', 'filesystem.write', 'app.restart'],
      supportsDryRun: true,
      tags: ['dataSync', 'sync', 'webdav', 'restore', 'snapshot'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input, { requireCredentials: true })
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        if (context.dryRun) {
          return okResult('Data sync snapshot restore dry run completed', sanitizeForAgent({ config }))
        }

        await runWebDavCapability('恢复安全快照', () => appDataSyncService.restoreLatestSnapshot(config))
        return okResult('Data sync snapshot restore started')
      }
    }
  ]
}
