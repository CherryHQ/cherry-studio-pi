import { appDataSyncService } from '@main/services/appData/AppDataSyncService'
import { reduxService } from '@main/services/ReduxService'
import { describeWebDavUserFacingError } from '@main/services/WebDavRetry'
import type { WebDavConfig } from '@types'

import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const DEFAULT_DATA_SYNC_PATH = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'

type DataSyncSettingsState = {
  dataSyncWebdavHost?: string
  dataSyncWebdavUser?: string
  dataSyncWebdavPass?: string
  dataSyncWebdavPath?: string
  dataSyncAutoSync?: boolean
  dataSyncSyncInterval?: number
}

async function getDataSyncSettings(): Promise<DataSyncSettingsState> {
  return (await reduxService.select('state.settings')) ?? {}
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

async function resolveWebDavConfig(input: any): Promise<WebDavConfig> {
  const stored = await getStoredWebDavConfig()
  return {
    webdavHost: input?.webdavHost ?? stored.webdavHost,
    webdavUser: input?.webdavUser ?? stored.webdavUser,
    webdavPass: input?.webdavPass ?? stored.webdavPass,
    webdavPath: input?.webdavPath ?? stored.webdavPath
  }
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

async function runWebDavCapability<T>(action: string, fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (error) {
    throw new Error(describeWebDavUserFacingError(error, action))
  }
}

async function persistWebDavConfig(config: WebDavConfig, options: { autoSync?: boolean; syncInterval?: number } = {}) {
  await reduxService.dispatch({ type: 'settings/setDataSyncWebdavHost', payload: config.webdavHost || '' })
  await reduxService.dispatch({ type: 'settings/setDataSyncWebdavUser', payload: config.webdavUser || '' })
  await reduxService.dispatch({ type: 'settings/setDataSyncWebdavPass', payload: config.webdavPass || '' })
  await reduxService.dispatch({
    type: 'settings/setDataSyncWebdavPath',
    payload: config.webdavPath || DEFAULT_DATA_SYNC_PATH
  })

  if (typeof options.syncInterval === 'number') {
    await reduxService.dispatch({ type: 'settings/setDataSyncSyncInterval', payload: options.syncInterval })
  }
  if (typeof options.autoSync === 'boolean') {
    await reduxService.dispatch({ type: 'settings/setDataSyncAutoSync', payload: options.autoSync })
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
      tags: ['dataSync', 'sync', 'webdav', 'configure', 'settings'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input)
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        if (context.dryRun) {
          return okResult('WebDAV data sync config dry run completed', sanitizeForAgent(config))
        }

        await persistWebDavConfig(config, {
          autoSync: typeof input?.autoSync === 'boolean' ? input.autoSync : undefined,
          syncInterval: typeof input?.syncInterval === 'number' ? input.syncInterval : undefined
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
        const config = await resolveWebDavConfig(input)
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        return okResult(
          'WebDAV directories listed',
          sanitizeForAgent(
            await runWebDavCapability('读取远程目录', () =>
              appDataSyncService.listRemoteDirectories(config, input?.remotePath || '/')
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
        const config = await resolveWebDavConfig(input)
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')

        const [status, directories, writeAccess] = await runWebDavCapability('诊断 WebDAV 同步', async () => {
          const [nextStatus, nextDirectories] = await Promise.all([
            appDataSyncService.getStatus(),
            appDataSyncService.listRemoteDirectories(config, input?.remotePath || config.webdavPath || '/')
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
      tags: ['dataSync', 'sync', 'webdav', 'run'],
      examples: ['Sync my data now', 'Run WebDAV data sync'],
      execute: async (input: any, context) => {
        const config = await resolveWebDavConfig(input)
        if (!hasWebDavHost(config)) throw new Error('WebDAV host is required')
        if (context.dryRun) {
          return okResult('Data sync dry run completed', sanitizeForAgent({ config }))
        }

        if (input?.saveConfig === true) {
          await persistWebDavConfig(config)
        }
        return okResult(
          'Data sync completed',
          sanitizeForAgent(await runWebDavCapability('同步数据', () => appDataSyncService.syncNow(config)))
        )
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
        const config = await resolveWebDavConfig(input)
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
