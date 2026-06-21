import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(),
  handleSaveData: vi.fn(),
  handleData: vi.fn(),
  decryptToken: vi.fn(),
  getDeviceType: vi.fn(),
  listWebdavFiles: vi.fn(),
  backupToWebdav: vi.fn(),
  restoreFromWebdav: vi.fn(),
  preferenceCache: new Map<string, unknown>(),
  modalError: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    getCachedValue: vi.fn((key: string) => mocks.preferenceCache.get(key))
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      verbose: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    dispatch: mocks.dispatch,
    getState: mocks.getState
  },
  handleSaveData: mocks.handleSaveData
}))

vi.mock('@renderer/store/nutstore', () => ({
  setNutstoreSyncState: (payload: unknown) => ({ payload, type: 'nutstore/setSyncState' })
}))

vi.mock('../BackupService', () => ({
  handleData: mocks.handleData
}))

import { backupToNutstore, restoreFromNutstore, startNutstoreAutoSync, stopNutstoreAutoSync } from '../NutstoreService'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function nutstoreState(overrides: Record<string, unknown> = {}) {
  return {
    nutstore: {
      nutstoreAutoSync: false,
      nutstoreMaxBackups: 5,
      nutstorePath: '/Cherry Studio Pi',
      nutstoreSkipBackupFile: false,
      nutstoreSyncInterval: 1,
      nutstoreSyncState: {},
      nutstoreToken: 'encrypted-token',
      ...overrides
    }
  }
}

describe('NutstoreService', () => {
  let originalApi: unknown
  let originalModal: unknown
  let originalToast: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.preferenceCache.clear()
    stopNutstoreAutoSync()
    mocks.getState.mockReturnValue(nutstoreState())
    mocks.handleSaveData.mockResolvedValue(undefined)
    mocks.decryptToken.mockResolvedValue({ access_token: 'access-token', username: 'user' })
    mocks.getDeviceType.mockResolvedValue('mac')
    mocks.listWebdavFiles.mockResolvedValue([])
    mocks.backupToWebdav.mockResolvedValue(true)
    mocks.restoreFromWebdav.mockResolvedValue(undefined)

    originalApi = window.api
    originalModal = window.modal
    originalToast = window.toast
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        backup: {
          backupToWebdav: mocks.backupToWebdav,
          listWebdavFiles: mocks.listWebdavFiles,
          restoreFromWebdav: mocks.restoreFromWebdav
        },
        nutstore: {
          decryptToken: mocks.decryptToken
        },
        system: {
          getDeviceType: mocks.getDeviceType
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess
      }
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        error: mocks.modalError
      }
    })
  })

  afterEach(() => {
    stopNutstoreAutoSync()
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: originalModal
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: originalToast
    })
  })

  it('reschedules auto-sync when start is called again with updated preferences', async () => {
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'))
    mocks.getState.mockReturnValue(
      nutstoreState({
        nutstoreSyncState: {
          lastSyncTime: Date.now()
        },
        nutstoreToken: ''
      })
    )
    mocks.preferenceCache.set('data.backup.nutstore.token', 'cached-token')
    mocks.preferenceCache.set('data.backup.nutstore.path', '/cached-path')
    mocks.preferenceCache.set('data.backup.nutstore.sync_interval', 1)

    await startNutstoreAutoSync()
    mocks.preferenceCache.set('data.backup.nutstore.sync_interval', 2)
    await startNutstoreAutoSync()

    await vi.advanceTimersByTimeAsync(60_999)
    expect(mocks.backupToWebdav).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(1)
    expect(mocks.backupToWebdav).toHaveBeenCalledWith(
      expect.objectContaining({
        webdavPath: '/cached-path'
      })
    )
  })

  it('uses cached Nutstore preferences when legacy Redux settings are stale', async () => {
    mocks.getState.mockReturnValue(
      nutstoreState({
        nutstoreMaxBackups: 0,
        nutstorePath: '/stale-path',
        nutstoreSkipBackupFile: false,
        nutstoreToken: ''
      })
    )
    mocks.preferenceCache.set('data.backup.nutstore.token', 'cached-token')
    mocks.preferenceCache.set('data.backup.nutstore.path', '/cached-nutstore')
    mocks.preferenceCache.set('data.backup.nutstore.skip_backup_file', true)
    mocks.preferenceCache.set('data.backup.nutstore.max_backups', 0)

    await backupToNutstore()

    expect(mocks.decryptToken).toHaveBeenCalledWith('cached-token')
    expect(mocks.backupToWebdav).toHaveBeenCalledWith(
      expect.objectContaining({
        skipBackupFile: true,
        webdavPath: '/cached-nutstore'
      })
    )
  })

  it('does not parse empty direct-restore responses from Nutstore backups', async () => {
    mocks.restoreFromWebdav.mockResolvedValueOnce('')

    await restoreFromNutstore('direct.zip')

    expect(mocks.restoreFromWebdav).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'direct.zip' }))
    expect(mocks.handleData).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('preserves Nutstore backup failure details in sync state', async () => {
    mocks.backupToWebdav.mockRejectedValueOnce('nutstore quota exceeded')

    await backupToNutstore()

    expect(mocks.dispatch).toHaveBeenCalledWith({
      payload: { lastSyncError: 'nutstore quota exceeded' },
      type: 'nutstore/setSyncState'
    })
  })

  it('preserves nested Nutstore restore errors in the modal', async () => {
    mocks.restoreFromWebdav.mockRejectedValueOnce({
      error: {
        message: 'nutstore restore permission denied'
      }
    })

    await restoreFromNutstore('remote.zip')

    expect(mocks.modalError).toHaveBeenCalledWith({
      title: 'message.restore.failed',
      content: 'nutstore restore permission denied'
    })
  })

  it('does not reschedule after auto sync is stopped during an in-flight backup', async () => {
    const backup = deferred<boolean>()
    mocks.backupToWebdav.mockReturnValueOnce(backup.promise)

    await startNutstoreAutoSync()
    await vi.advanceTimersByTimeAsync(60_000)

    await vi.waitFor(() => {
      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(1)
    })

    stopNutstoreAutoSync()
    backup.resolve(true)
    await vi.advanceTimersByTimeAsync(0)

    await vi.waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({
        payload: expect.objectContaining({ syncing: false }),
        type: 'nutstore/setSyncState'
      })
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
