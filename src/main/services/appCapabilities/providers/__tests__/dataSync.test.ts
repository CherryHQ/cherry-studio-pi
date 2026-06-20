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

  it('falls back quickly when the renderer settings bridge is unresponsive', async () => {
    vi.useFakeTimers()
    try {
      mocks.storageV2Service.getSetting.mockResolvedValue(null)
      mocks.secretVault.getSecret.mockResolvedValue(null)
      mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(() => new Promise(() => undefined))

      const resultPromise = capability('dataSync.webdav.config.get').execute({}, { source: 'agent' })

      await vi.advanceTimersByTimeAsync(800)

      await expect(resultPromise).resolves.toMatchObject({
        ok: true,
        data: {
          webdavHost: '',
          webdavUser: '',
          webdavPass: '',
          webdavPath: '/cherry-studio-pi',
          autoSync: false,
          syncInterval: 0
        }
      })
    } finally {
      vi.useRealTimers()
    }
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

  it('keeps saved WebDAV config when the renderer refresh bridge is unresponsive', async () => {
    vi.useFakeTimers()
    try {
      mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(() => new Promise(() => undefined))

      const resultPromise = capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          webdavPath: '/sync-root'
        },
        { source: 'agent' }
      )

      await vi.advanceTimersByTimeAsync(800)

      await expect(resultPromise).resolves.toMatchObject({
        ok: true,
        summary: 'WebDAV data sync config saved'
      })
      expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
        'settings.dataSyncWebdavHost',
        'https://dav.example.com',
        'settings'
      )
      expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
        'settings.dataSyncWebdavPath',
        '/sync-root',
        'settings'
      )
    } finally {
      vi.useRealTimers()
    }
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

  it('normalizes boolean-like WebDAV config flags before saving', async () => {
    const result = await capability('dataSync.webdav.config.set').execute(
      {
        webdavHost: 'dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        autoSync: 'off'
      },
      { source: 'agent' }
    )

    const setCall = mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.find(([script]) =>
      String(script).startsWith(`window[${JSON.stringify(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)}](`)
    )
    expect(result.ok).toBe(true)
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith('settings.dataSyncAutoSync', false, 'settings')
    expect(setCall?.[0]).toContain('"dataSyncAutoSync":false')
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

  it('rejects non-numeric WebDAV sync interval shapes before saving settings', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          syncInterval: true
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Sync interval must be a finite number of minutes')

    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
  })

  it('rejects invalid WebDAV boolean flags before saving settings', async () => {
    await expect(
      capability('dataSync.webdav.config.set').execute(
        {
          webdavHost: 'dav.example.com',
          webdavUser: 'user',
          webdavPass: 'secret',
          autoSync: 'sometimes'
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Auto sync must be a boolean')

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

  it('rejects invalid WebDAV text field shapes before saving settings', async () => {
    for (const [field, value, message] of [
      ['webdavHost', true, 'WebDAV host must be a string'],
      ['webdavUser', 123, 'WebDAV username must be a string'],
      ['webdavPass', { secret: 'value' }, 'WebDAV password must be a string'],
      ['webdavPath', ['sync-root'], 'WebDAV path must be a string']
    ] as const) {
      await expect(
        capability('dataSync.webdav.config.set').execute(
          {
            webdavHost: 'dav.example.com',
            webdavUser: 'user',
            webdavPass: 'secret',
            [field]: value
          },
          { source: 'agent' }
        )
      ).rejects.toThrow(message)
    }

    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(
      mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.some(([script]) =>
        String(script).startsWith(`window[${JSON.stringify(RENDERER_SET_DATA_SYNC_SETTINGS_BRIDGE)}](`)
      )
    ).toBe(false)
  })

  it('rejects invalid data sync capability input objects before side effects', async () => {
    await expect(capability('dataSync.status.get').execute('status' as any, { source: 'agent' })).rejects.toThrow(
      'Data sync capability input must be an object'
    )
    await expect(
      capability('dataSync.webdav.config.get').execute(['config'] as any, { source: 'agent' })
    ).rejects.toThrow('Data sync capability input must be an object')
    await expect(
      capability('dataSync.webdav.config.set').execute('dav.example.com' as any, { source: 'agent' })
    ).rejects.toThrow('Data sync capability input must be an object')
    await expect(capability('dataSync.webdav.directories.list').execute([], { source: 'agent' })).rejects.toThrow(
      'Data sync capability input must be an object'
    )
    await expect(capability('dataSync.webdav.diagnose').execute(true as any, { source: 'agent' })).rejects.toThrow(
      'Data sync capability input must be an object'
    )
    await expect(capability('dataSync.sync.now').execute(['sync'] as any, { source: 'agent' })).rejects.toThrow(
      'Data sync capability input must be an object'
    )
    await expect(
      capability('dataSync.snapshot.restoreLatest').execute('restore' as any, { source: 'agent' })
    ).rejects.toThrow('Data sync capability input must be an object')

    expect(mocks.storageV2Service.getSetting).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
    expect(mocks.secretVault.getSecret).not.toHaveBeenCalled()
    expect(mocks.secretVault.setSecret).not.toHaveBeenCalled()
    expect(mocks.appDataSyncService.getStatus).not.toHaveBeenCalled()
    expect(mocks.appDataSyncService.listRemoteDirectories).not.toHaveBeenCalled()
    expect(mocks.appDataSyncService.checkWriteAccess).not.toHaveBeenCalled()
    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
    expect(mocks.appDataSyncService.restoreLatestSnapshot).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('declares dry-run support for write capabilities that implement dry-run branches', () => {
    expect(capability('dataSync.webdav.config.set').supportsDryRun).toBe(true)
    expect(capability('dataSync.webdav.diagnose').supportsDryRun).toBe(true)
    expect(capability('dataSync.sync.now').supportsDryRun).toBe(true)
    expect(capability('dataSync.snapshot.restoreLatest').supportsDryRun).toBe(true)
  })

  it('declares complete local and remote side effects for data sync write capabilities', () => {
    expect(capability('dataSync.webdav.config.set')).toMatchObject({
      permissions: ['dataSync.settings.write'],
      sideEffects: expect.arrayContaining(['database.write', 'settings.write'])
    })
    expect(capability('dataSync.webdav.diagnose')).toMatchObject({
      permissions: ['network.webdav.read', 'network.webdav.write'],
      sideEffects: expect.arrayContaining(['database.read', 'network.webdav.read', 'network.webdav.write'])
    })
    expect(capability('dataSync.sync.now')).toMatchObject({
      permissions: ['dataSync.write', 'network.webdav.write'],
      sideEffects: expect.arrayContaining([
        'database.read',
        'database.write',
        'filesystem.read',
        'filesystem.write',
        'network.webdav.read',
        'network.webdav.write',
        'settings.write'
      ])
    })
    expect(capability('dataSync.snapshot.restoreLatest')).toMatchObject({
      permissions: ['dataSync.restore'],
      sideEffects: expect.arrayContaining([
        'app.restart',
        'database.read',
        'database.write',
        'filesystem.delete',
        'filesystem.read',
        'filesystem.write',
        'network.webdav.read'
      ])
    })
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

  it('rejects invalid remote directory path shapes before WebDAV requests', async () => {
    await expect(
      capability('dataSync.webdav.directories.list').execute({ remotePath: ['team'] }, { source: 'agent' })
    ).rejects.toThrow('Remote path must be a string')

    expect(mocks.appDataSyncService.listRemoteDirectories).not.toHaveBeenCalled()
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

  it('passes agent abort signals into WebDAV browse, diagnosis, and restore calls', async () => {
    const controller = new AbortController()
    const signalContext = { source: 'agent' as const, signal: controller.signal }
    const config = {
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/sync-root'
    }

    mocks.appDataSyncService.listRemoteDirectories.mockResolvedValue({ path: '/', directories: [] })
    mocks.appDataSyncService.getStatus.mockResolvedValue({ deviceId: 'device-1', conflicts: [] })
    mocks.appDataSyncService.checkWriteAccess.mockResolvedValue({ ok: true, basePath: '/sync-root/sync/v1' })
    mocks.appDataSyncService.restoreLatestSnapshot.mockResolvedValue({ ok: true })

    await capability('dataSync.webdav.directories.list').execute({ remotePath: '/' }, signalContext)
    expect(mocks.appDataSyncService.listRemoteDirectories).toHaveBeenLastCalledWith(config, '/', {
      signal: controller.signal
    })

    await capability('dataSync.webdav.diagnose').execute({}, signalContext)
    expect(mocks.appDataSyncService.listRemoteDirectories).toHaveBeenLastCalledWith(config, '/sync-root', {
      signal: controller.signal
    })
    expect(mocks.appDataSyncService.checkWriteAccess).toHaveBeenLastCalledWith(config, { signal: controller.signal })

    await capability('dataSync.snapshot.restoreLatest').execute({}, signalContext)
    expect(mocks.appDataSyncService.restoreLatestSnapshot).toHaveBeenLastCalledWith(config, {
      signal: controller.signal
    })
  })

  it('does not wrap agent-cancelled WebDAV capability calls as user-facing WebDAV failures', async () => {
    const controller = new AbortController()
    mocks.appDataSyncService.listRemoteDirectories.mockImplementationOnce(async () => {
      controller.abort(new Error('agent stopped WebDAV browse'))
      throw controller.signal.reason
    })

    await expect(
      capability('dataSync.webdav.directories.list').execute(
        { remotePath: '/' },
        {
          source: 'agent',
          signal: controller.signal
        }
      )
    ).rejects.toThrow('agent stopped WebDAV browse')
  })

  it('supports data sync dry runs without writing remote data', async () => {
    const result = await capability('dataSync.sync.now').execute({}, { source: 'agent', dryRun: true })

    expect(result.ok).toBe(true)
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(result.summary).toContain('dry run')
    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
  })

  it('normalizes boolean-like saveConfig input before syncing', async () => {
    mocks.appDataSyncService.syncNow.mockResolvedValueOnce({ status: 'success' })

    const result = await capability('dataSync.sync.now').execute(
      {
        webdavHost: 'dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        webdavPath: '/team-sync',
        saveConfig: 'true'
      },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(mocks.storageV2Service.setSetting).toHaveBeenCalledWith(
      'settings.dataSyncWebdavHost',
      'https://dav.example.com',
      'settings'
    )
    expect(mocks.appDataSyncService.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/team-sync'
    })
  })

  it('rejects invalid saveConfig input before syncing', async () => {
    await expect(
      capability('dataSync.sync.now').execute({ saveConfig: 'sometimes' }, { source: 'agent' })
    ).rejects.toThrow('Save config must be a boolean')

    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.setSetting).not.toHaveBeenCalled()
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

  it('passes agent abort signals into long-running data sync calls', async () => {
    const controller = new AbortController()
    mocks.appDataSyncService.syncNow.mockResolvedValueOnce({ status: 'success' })

    await capability('dataSync.sync.now').execute({}, { source: 'agent', signal: controller.signal })

    expect(mocks.appDataSyncService.syncNow).toHaveBeenCalledWith(
      {
        webdavHost: 'https://dav.example.com',
        webdavUser: 'user',
        webdavPass: 'secret',
        webdavPath: '/sync-root'
      },
      { signal: controller.signal }
    )
  })

  it('stops before syncing when renderer preparation is cancelled by the caller signal', async () => {
    const controller = new AbortController()
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE)) {
        controller.abort(new Error('agent cancelled data sync preparation'))
        throw new Error('agent cancelled data sync preparation')
      }
      return undefined
    })

    await expect(
      capability('dataSync.sync.now').execute({}, { source: 'agent', signal: controller.signal })
    ).rejects.toThrow('agent cancelled data sync preparation')

    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
    expect(mocks.browserWindows[0].webContents.send).not.toHaveBeenCalled()
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
