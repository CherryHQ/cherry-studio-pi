import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserWindows: [
    {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn()
      }
    }
  ],
  getAllWindows: vi.fn(),
  reduxService: {
    select: vi.fn(),
    dispatch: vi.fn(),
    prepareStorageV2ForDataSync: vi.fn()
  },
  appDataSyncService: {
    getStatus: vi.fn(),
    listRemoteDirectories: vi.fn(),
    checkWriteAccess: vi.fn(),
    syncNow: vi.fn(),
    recordSyncFailure: vi.fn(),
    restoreLatestSnapshot: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: mocks.reduxService
}))

vi.mock('@main/services/appData/AppDataSyncService', () => ({
  appDataSyncService: mocks.appDataSyncService
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

function capability(id: string) {
  const item = createDataSyncCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('data sync app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.reduxService.select.mockResolvedValue(settings)
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
    mocks.reduxService.prepareStorageV2ForDataSync.mockResolvedValue(undefined)
  })

  it('reads WebDAV config with secrets redacted', async () => {
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
        webdavPass: 'secret',
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
    expect(mocks.reduxService.prepareStorageV2ForDataSync).not.toHaveBeenCalled()
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
    expect(mocks.reduxService.prepareStorageV2ForDataSync).toHaveBeenCalledTimes(1)
    expect(mocks.appDataSyncService.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.com',
      webdavUser: 'user',
      webdavPass: 'secret',
      webdavPath: '/sync-root'
    })
    expect(mocks.reduxService.prepareStorageV2ForDataSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appDataSyncService.syncNow.mock.invocationCallOrder[0]
    )
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
})
