import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reduxService: {
    select: vi.fn(),
    dispatch: vi.fn()
  },
  appDataSyncService: {
    getStatus: vi.fn(),
    listRemoteDirectories: vi.fn(),
    syncNow: vi.fn(),
    restoreLatestSnapshot: vi.fn()
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
    mocks.reduxService.select.mockResolvedValue(settings)
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
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

  it('supports data sync dry runs without writing remote data', async () => {
    const result = await capability('dataSync.sync.now').execute({}, { source: 'agent', dryRun: true })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('dry run')
    expect(mocks.appDataSyncService.syncNow).not.toHaveBeenCalled()
  })
})
