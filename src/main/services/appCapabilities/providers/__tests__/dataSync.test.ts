import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserWindows: [
    {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
        executeJavaScript: vi.fn()
      }
    }
  ],
  getAllWindows: vi.fn(),
  appDataSyncService: {
    getStatus: vi.fn(),
    listRemoteDirectories: vi.fn(),
    checkWriteAccess: vi.fn(),
    syncNow: vi.fn(),
    recordSyncFailure: vi.fn(),
    restoreLatestSnapshot: vi.fn()
  },
  storageV2Service: {
    getSetting: vi.fn(),
    setSetting: vi.fn()
  },
  secretVault: {
    getSecret: vi.fn(),
    setSecret: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

vi.mock('@main/services/appData/AppDataSyncService', () => ({
  appDataSyncService: mocks.appDataSyncService
}))

vi.mock('@main/services/storageV2/StorageService', () => ({
  storageV2Service: mocks.storageV2Service
}))

vi.mock('@main/services/storageV2/SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

vi.mock('../../utils', () => ({
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  sanitizeForAgent: (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, item) => {
        if (/pass|password|secret|token|api[-_]?key/i.test(key) && typeof item === 'string') {
          return item ? '[redacted]' : item
        }
        return item
      })
    )
}))

import {
  RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE,
  RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
  RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE
} from '@shared/dataSyncBridge'
import { IpcChannel } from '@shared/IpcChannel'

import { createDataSyncCapabilities } from '../dataSync'

const settings = {
  dataSyncWebdavHost: 'https://dav.example.com',
  dataSyncWebdavUser: 'user',
  dataSyncWebdavPass: 'secret',
  dataSyncWebdavPath: '/sync-root',
  dataSyncAutoSync: true,
  dataSyncSyncInterval: 15
}
const DATA_SYNC_PASS_SECRET_REF = 'storage-v2://secret/settings/dataSyncWebdavPass/dataSyncWebdavPassword'

function mockStorageV2DataSyncSettings(overrides: Partial<typeof settings> = {}) {
  const next = { ...settings, ...overrides }
  const values = new Map<string, unknown>([
    ['settings.dataSyncWebdavHost', next.dataSyncWebdavHost],
    ['settings.dataSyncWebdavUser', next.dataSyncWebdavUser],
    ['settings.dataSyncWebdavPass', { secretRef: DATA_SYNC_PASS_SECRET_REF }],
    ['settings.dataSyncWebdavPath', next.dataSyncWebdavPath],
    ['settings.dataSyncAutoSync', next.dataSyncAutoSync],
    ['settings.dataSyncSyncInterval', next.dataSyncSyncInterval]
  ])

  mocks.storageV2Service.getSetting.mockImplementation(async (key: string) => values.get(key) ?? null)
  mocks.secretVault.getSecret.mockImplementation(async (secretRef: string) =>
    secretRef === DATA_SYNC_PASS_SECRET_REF ? next.dataSyncWebdavPass : null
  )
}

function capability(id: string) {
  const item = createDataSyncCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('data sync app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.browserWindows[0].isDestroyed.mockReturnValue(false)
    mocks.browserWindows[0].webContents.isDestroyed.mockReturnValue(false)
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE)) return settings
      if (script.includes(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)) return settings
      if (script.includes(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE)) return undefined
      return undefined
    })
    mockStorageV2DataSyncSettings()
    mocks.storageV2Service.setSetting.mockResolvedValue({ key: '', value: null, scope: 'settings' })
    mocks.secretVault.setSecret.mockResolvedValue(DATA_SYNC_PASS_SECRET_REF)
  })

  it('reads WebDAV config from Storage v2 with secrets redacted', async () => {
    const result = await capability('dataSync.webdav.config.get').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: '[redacted]',
      webdavPath: '/sync-root',
      autoSync: true,
      syncInterval: 15
    })
    expect(mocks.secretVault.getSecret).toHaveBeenCalledWith(DATA_SYNC_PASS_SECRET_REF)
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('falls back to the renderer settings bridge when Storage v2 has no sync config yet', async () => {
    mocks.storageV2Service.getSetting.mockResolvedValue(null)
    mocks.secretVault.getSecret.mockResolvedValue(null)

    const result = await capability('dataSync.webdav.config.get').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: '[redacted]'
    })
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `window[${JSON.stringify(RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE)}]()`
    )
  })

  it('falls back to the renderer settings bridge when Storage v2 settings cannot be read', async () => {
    mocks.storageV2Service.getSetting.mockRejectedValueOnce(new Error('database is busy'))

    const result = await capability('dataSync.webdav.config.get').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: '[redacted]'
    })
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `window[${JSON.stringify(RENDERER_GET_DATA_SYNC_SETTINGS_BRIDGE)}]()`
    )
  })

  it('saves WebDAV config to Storage v2 and refreshes the renderer settings bridge when available', async () => {
    const result = await capability('dataSync.webdav.config.set').execute(
      {
        webdavHost: ' dav.example.com ',
        webdavUser: ' user ',
        webdavPass: ' secret ',
        webdavPath: ' Team//Sync/ ',
        autoSync: false,
        syncInterval: 30
      },
      { source: 'agent' }
    )

    const setCall = mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.find(([script]) =>
      String(script).startsWith(`window[${JSON.stringify(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)}](`)
    )
    expect(result.ok).toBe(true)
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'settings',
      'dataSyncWebdavPass',
      'dataSyncWebdavPassword',
      ' secret '
    )
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
      'settings.dataSyncWebdavPass',
      { secretRef: DATA_SYNC_PASS_SECRET_REF },
      'settings'
    )
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
      'settings.dataSyncWebdavHost',
      'https://dav.example.com',
      'settings'
    )
    expect(setCall?.[0]).toContain('"dataSyncWebdavHost":"https://dav.example.com"')
    expect(setCall?.[0]).toContain('"dataSyncWebdavUser":"user"')
    expect(setCall?.[0]).toContain('"dataSyncWebdavPass":" secret "')
    expect(setCall?.[0]).toContain('"dataSyncWebdavPath":"/Team/Sync"')
    expect(setCall?.[0]).toContain('"dataSyncAutoSync":false')
    expect(setCall?.[0]).toContain('"dataSyncSyncInterval":30')
  })

  it('normalizes numeric string WebDAV sync intervals before saving', async () => {
    const result = await capability('dataSync.webdav.config.set').execute(
      {
        webdavHost: 'dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        syncInterval: '30.9'
      },
      { source: 'agent' }
    )

    const setCall = mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.find(([script]) =>
      String(script).startsWith(`window[${JSON.stringify(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)}](`)
    )
    expect(result.ok).toBe(true)
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith('settings.dataSyncSyncInterval', 30, 'settings')
    expect(setCall?.[0]).toContain('"dataSyncSyncInterval":30')
  })

  it('allows updating WebDAV sync options from stored config without requiring host in schema', async () => {
    expect(capability('dataSync.webdav.config.set').inputSchema.required ?? []).not.toContain('webdavHost')

    const result = await capability('dataSync.webdav.config.set').execute(
      {
        autoSync: false,
        syncInterval: '45'
      },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
      'settings.dataSyncWebdavHost',
      'https://dav.example.com',
      'settings'
    )
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith('settings.dataSyncAutoSync', false, 'settings')
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith('settings.dataSyncSyncInterval', 45, 'settings')
  })

  it('rejects invalid WebDAV sync intervals before saving settings', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          syncInterval: Number.NaN
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Sync interval must be a finite number of minutes')

    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
  })

  it('validates WebDAV sync intervals during dry runs before reporting success', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          syncInterval: Number.NaN
        },
        { source: 'agent', dryRun: true }
      )
    ).rejects.toThrow('Sync interval must be a finite number of minutes')

    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
  })

  it('rejects negative WebDAV sync intervals before saving settings', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          syncInterval: -1
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Sync interval cannot be negative')

    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
  })

  it('rejects saving WebDAV config without credentials', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'http://192.168.1.100:8080',
          webdavUser: '',
          webdavPass: ''
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('WebDAV 用户名和密码不能为空')

    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(
      mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.some(([script]) =>
        String(script).startsWith(`window[${JSON.stringify(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)}](`)
      )
    ).toBe(false)
  })

  it('declares dry-run support for write capabilities that implement dry-run branches', () => {
    expect(capability('dataSync.webdav.config.set').supportsDryRun).toBe(true)
    expect(capability('dataSync.webdav.diagnose').supportsDryRun).toBe(true)
    expect(capability('dataSync.sync.now').supportsDryRun).toBe(true)
    expect(capability('dataSync.snapshot.restoreLatest').supportsDryRun).toBe(true)
  })

  it('lists WebDAV directories using stored config by default', async () => {
    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValueOnce({ path: '/', directories: [] })

    await capability('dataSync.webdav.directories.list').execute({ remotePath: '/' }, { source: 'agent' })

    expect(mocks.appDataSyncService.listRemoteDirectories).toHaveBeenCalledWith(
      {
        webdavHost: 'https://dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        webdavPath: '/sync-root'
      },
      '/'
    )
  })

  it('normalizes WebDAV config fields and directory paths before listing', async () => {
    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValueOnce({ path: '/folder/child', directories: [] })

    await capability('dataSync.webdav.directories.list').execute(
      {
        webdavHost: ' dav.example.com ',
        webdavUser: ' user ',
        webdavPass: ' secret ',
        webdavPath: ' Team//Sync/ ',
        remotePath: ' folder\\\\child// '
      },
      { source: 'agent' }
    )

    expect(mocks.appDataSyncService.listRemoteDirectories).toHaveBeenCalledWith(
      {
        webdavHost: 'https://dav.example.com',
        webdavUser: 'user',
        webdavPass: ' secret ',
        webdavPath: '/Team/Sync'
      },
      '/folder/child'
    )
  })

  it('diagnoses WebDAV write access outside dry runs', async () => {
    mocks.appDataSyncService.getStatus.mockResolvedValueOnce({ deviceId: 'device-1', conflicts: [] })
    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValueOnce({ path: '/sync-root', directories: [] })
    mocks.appDataSyncService.checkWriteAccess.mockResolvedValueOnce({ ok: true, basePath: '/sync-root/sync/v1' })

    const result = await capability('dataSync.webdav.diagnose').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(mocks.appDataSyncService.checkWriteAccess).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/sync-root'
    })
    expect(result.data).toMatchObject({
      writeAccess: { ok: true, basePath: '/sync-root/sync/v1' }
    })
  })

  it('falls back to the configured sync path for blank diagnosis paths', async () => {
    mocks.appDataSyncService.getStatus.mockResolvedValueOnce({ deviceId: 'device-1', conflicts: [] })
    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValueOnce({ path: '/sync-root', directories: [] })
    mocks.appDataSyncService.checkWriteAccess.mockResolvedValueOnce({ ok: true, basePath: '/sync-root/sync/v1' })

    await capability('dataSync.webdav.diagnose').execute({ remotePath: '   ' }, { source: 'agent' })

    expect(mocks.appDataSyncService.listRemoteDirectories).toHaveBeenCalledWith(
      expect.objectContaining({ webdavPath: '/sync-root' }),
      '/sync-root'
    )
  })

  it('keeps WebDAV diagnosis dry runs read-only', async () => {
    mocks.appDataSyncService.getStatus.mockResolvedValueOnce({ deviceId: 'device-1', conflicts: [] })
    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValueOnce({ path: '/sync-root', directories: [] })

    await capability('dataSync.webdav.diagnose').execute({}, { source: 'agent', dryRun: true })

    expect(mocks.appDataSyncService.checkWriteAccess).not.toHaveBeenCalled()
  })

  it('supports data sync dry runs without writing remote data', async () => {
    const result = await capability('dataSync.sync.now').execute({}, { source: 'agent', dryRun: true })

    expect(result.ok).toBe(true)
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(result.summary).toContain('dry run')
    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
  })

  it('prepares renderer runtime data and broadcasts completion after agent-triggered data sync', async () => {
    const summary = {
      status: 'success',
      storageDownloaded: 2,
      storageRecordCount: 10,
      storageBundleHash: 'bundle-hash',
      lastSyncAt: 1780058147577
    }
    mocks.appDataSyncService.syncNow.mockResolvedValueOnce(summary)

    const result = await capability('dataSync.sync.now').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `typeof window[${JSON.stringify(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE)}] === 'function'`
    )
    expect(mocks.browserWindows[0].webContents.executeJavaScript).toHaveBeenCalledWith(
      `window[${JSON.stringify(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE)}]()`
    )
    expect(mocks.appDataSyncService.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/sync-root'
    })
    const prepareCallIndex = mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.findIndex(([script]) =>
      String(script).includes(`window[${JSON.stringify(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE)}]()`)
    )
    expect(
      mocks.browserWindows[0].webContents.executeJavaScript.mock.invocationCallOrder[prepareCallIndex]
    ).toBeLessThan(mocks.appDataSyncService.syncNow.mock.invocationCallOrder[0])
    expect(mocks.browserWindows[0].webContents.send).toHaveBeenCalledWith(IpcChannel.DataSync_ExternalSyncCompleted, {
      completedAt: expect.any(Number),
      source: 'agent',
      summary
    })
  })

  it('records a failure summary when agent-triggered data sync fails', async () => {
    mocks.appDataSyncService.syncNow.mockRejectedValueOnce(new Error('503 Service Unavailable'))

    await expect(capability('dataSync.sync.now').execute({}, { source: 'agent' })).rejects.toThrow(
      /WebDAV 服务暂时不可用/
    )

    expect(mocks.appDataSyncService.recordSyncFailure).toHaveBeenCalledWith(expect.any(Error))
    expect((mocks.appDataSyncService.recordSyncFailure.mock.calls[0][0] as Error).message).toContain(
      'WebDAV 服务暂时不可用'
    )
    expect(mocks.browserWindows[0].webContents.send).not.toHaveBeenCalled()
  })

  it('keeps sync successful when broadcasting completion to a closing renderer fails', async () => {
    mocks.appDataSyncService.syncNow.mockResolvedValueOnce({ status: 'success' })
    mocks.browserWindows[0].webContents.send.mockImplementationOnce(() => {
      throw new Error('window is closing')
    })

    const result = await capability('dataSync.sync.now').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(result.summary).toBe('Data sync completed')
  })

  it('keeps agent-triggered data sync running when the renderer preparation bridge is unavailable', async () => {
    mocks.browserWindows[0].webContents.executeJavaScript.mockResolvedValueOnce(false)
    mocks.appDataSyncService.syncNow.mockResolvedValueOnce({ status: 'success' })

    const result = await capability('dataSync.sync.now').execute(
      {
        webdavHost: 'https://dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        webdavPath: '/sync-root'
      },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(mocks.appDataSyncService.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/sync-root'
    })
    expect(mocks.browserWindows[0].webContents.send).toHaveBeenCalledWith(IpcChannel.DataSync_ExternalSyncCompleted, {
      completedAt: expect.any(Number),
      source: 'agent',
      summary: { status: 'success' }
    })
  })
})
