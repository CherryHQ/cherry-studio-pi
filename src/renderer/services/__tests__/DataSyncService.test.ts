import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataSync: {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    getStatus: vi.fn(),
    syncNow: vi.fn(),
    recordFailure: vi.fn(),
    onLocalStorageV2Changed: vi.fn(),
    onExternalSyncCompleted: vi.fn()
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

async function loadService() {
  vi.resetModules()
  return import('../DataSyncService')
}

describe('DataSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dataSync: mocks.dataSync
      }
    })
    mocks.dataSync.getConfig.mockResolvedValue({
      webdavHost: 'dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/Team',
      autoSync: true,
      syncInterval: 15
    })
    mocks.dataSync.setConfig.mockImplementation(async (config) => config)
    mocks.dataSync.getStatus.mockResolvedValue({
      deviceId: 'device-1',
      lastSummary: null,
      conflicts: [],
      syncing: false,
      syncStartedAt: null
    })
    mocks.dataSync.syncNow.mockResolvedValue({
      uploaded: 1,
      downloaded: 2,
      deleted: 0,
      conflicts: 0,
      skipped: 0,
      lastSyncAt: 1760000000000,
      status: 'success'
    })
    mocks.dataSync.recordFailure.mockResolvedValue(undefined)
    mocks.dataSync.onLocalStorageV2Changed.mockReturnValue(vi.fn())
    mocks.dataSync.onExternalSyncCompleted.mockReturnValue(vi.fn())
  })

  it('reads and writes data sync settings through the dataSync IPC bridge', async () => {
    const { readDataSyncSettings, writeDataSyncSettings } = await loadService()

    await expect(readDataSyncSettings()).resolves.toEqual({
      webdavHost: 'dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/Team',
      autoSync: true,
      syncInterval: 15
    })

    await writeDataSyncSettings({ syncInterval: 30, autoSync: true })

    expect(mocks.dataSync.setConfig).toHaveBeenCalledWith({
      webdavHost: 'dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/Team',
      autoSync: true,
      syncInterval: 30
    })
  })

  it('does not start a renderer sync when the main process is already syncing', async () => {
    mocks.dataSync.getStatus.mockResolvedValue({
      deviceId: 'device-1',
      lastSummary: null,
      conflicts: [],
      syncing: true,
      syncStartedAt: 1760000000000
    })
    const { syncAppDataNow } = await loadService()

    await expect(syncAppDataNow()).resolves.toBeNull()
    expect(mocks.dataSync.syncNow).not.toHaveBeenCalled()
  })

  it('normalizes config and invokes the main-process sync service', async () => {
    const { syncAppDataNow } = await loadService()

    await expect(syncAppDataNow()).resolves.toMatchObject({
      status: 'success',
      uploaded: 1,
      downloaded: 2
    })
    expect(mocks.dataSync.syncNow).toHaveBeenCalledWith({
      webdavHost: 'https://dav.example.test',
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/Team'
    })
  })
})
