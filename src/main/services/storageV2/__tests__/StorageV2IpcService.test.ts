import { IpcChannel } from '@shared/IpcChannel'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  runtimeFlush: vi.fn(),
  storageV2Service: {
    getDataRoot: vi.fn(),
    healthCheck: vi.fn(),
    getHealthSummary: vi.fn(),
    createSnapshot: vi.fn(),
    createBackup: vi.fn(),
    getBackupOverview: vi.fn(),
    validateBackup: vi.fn(),
    restoreBackup: vi.fn(),
    getMigrationAudit: vi.fn(),
    getLegacyRuntimePolicies: vi.fn(),
    getSensitiveLegacyProjectionCleanupPlan: vi.fn(),
    cleanupSensitiveLegacyProjections: vi.fn(),
    getStats: vi.fn(),
    getIntegrityReport: vi.fn(),
    getCoreSnapshot: vi.fn(),
    recordMigrationRun: vi.fn(),
    listMigrationRuns: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    listSettings: vi.fn(),
    listProviders: vi.fn(),
    upsertProvider: vi.fn(),
    deleteProvider: vi.fn(),
    listAssistants: vi.fn(),
    upsertAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    syncConversation: vi.fn(),
    upsertConversation: vi.fn(),
    upsertMessage: vi.fn(),
    upsertMessageBlocks: vi.fn(),
    deleteConversation: vi.fn(),
    listFiles: vi.fn(),
    getFile: vi.fn(),
    projectFilesToLegacyRuntime: vi.fn(),
    upsertFile: vi.fn(),
    deleteFile: vi.fn(),
    importLegacyReduxSnapshot: vi.fn(),
    importLegacyDexieSnapshot: vi.fn(),
    importLegacyAgentDb: vi.fn(),
    importLegacyAppDb: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../StorageService', () => ({
  storageV2Service: mocks.storageV2Service
}))

vi.mock('../../AppRuntimeSaveService', () => ({
  flushMainStorageV2RuntimeMirrors: mocks.runtimeFlush
}))

function getHandler(channel: IpcChannel) {
  const handler = mocks.handlers.get(channel)
  expect(handler).toBeDefined()
  return handler!
}

async function registerHandlers() {
  vi.resetModules()
  mocks.handlers.clear()
  const { registerStorageV2IpcHandlers } = await import('../StorageV2IpcService')
  registerStorageV2IpcHandlers()
}

describe('StorageV2IpcService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.runtimeFlush.mockResolvedValue(undefined)
    mocks.storageV2Service.createSnapshot.mockResolvedValue({ path: '/tmp/snapshot' })
    mocks.storageV2Service.createBackup.mockResolvedValue({ path: '/tmp/backup' })
    mocks.storageV2Service.restoreBackup.mockResolvedValue({ ok: true })
    await registerHandlers()
  })

  it('flushes main runtime mirrors before snapshot, backup, and restore IPC writes', async () => {
    await expect(getHandler(IpcChannel.StorageV2_CreateSnapshot)(null, 'manual-snapshot')).resolves.toEqual({
      path: '/tmp/snapshot'
    })
    await expect(getHandler(IpcChannel.StorageV2_CreateBackup)(null, 'manual-backup')).resolves.toEqual({
      path: '/tmp/backup'
    })
    await expect(getHandler(IpcChannel.StorageV2_RestoreBackup)(null, '/tmp/backup')).resolves.toEqual({ ok: true })

    expect(mocks.runtimeFlush).toHaveBeenCalledTimes(3)
    expect(mocks.storageV2Service.createSnapshot).toHaveBeenCalledWith('manual-snapshot')
    expect(mocks.storageV2Service.createBackup).toHaveBeenCalledWith('manual-backup')
    expect(mocks.storageV2Service.restoreBackup).toHaveBeenCalledWith('/tmp/backup')
    expect(mocks.runtimeFlush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storageV2Service.createSnapshot.mock.invocationCallOrder[0]
    )
    expect(mocks.runtimeFlush.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.storageV2Service.createBackup.mock.invocationCallOrder[0]
    )
    expect(mocks.runtimeFlush.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.storageV2Service.restoreBackup.mock.invocationCallOrder[0]
    )
  })

  it('does not continue Storage v2 write IPC operations when main runtime flush fails', async () => {
    mocks.runtimeFlush.mockRejectedValueOnce(new Error('provider mirror is locked'))

    await expect(getHandler(IpcChannel.StorageV2_CreateBackup)(null, 'manual-backup')).rejects.toThrow(
      'provider mirror is locked'
    )

    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
  })
})
