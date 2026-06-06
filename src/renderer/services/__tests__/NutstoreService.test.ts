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
  toastError: vi.fn(),
  toastSuccess: vi.fn()
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

import { startNutstoreAutoSync, stopNutstoreAutoSync } from '../NutstoreService'

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
  let originalToast: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stopNutstoreAutoSync()
    mocks.getState.mockReturnValue(nutstoreState())
    mocks.handleSaveData.mockResolvedValue(undefined)
    mocks.decryptToken.mockResolvedValue({ access_token: 'access-token', username: 'user' })
    mocks.getDeviceType.mockResolvedValue('mac')
    mocks.listWebdavFiles.mockResolvedValue([])
    mocks.backupToWebdav.mockResolvedValue(true)

    originalApi = window.api
    originalToast = window.toast
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        backup: {
          backupToWebdav: mocks.backupToWebdav,
          listWebdavFiles: mocks.listWebdavFiles
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
  })

  afterEach(() => {
    stopNutstoreAutoSync()
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: originalToast
    })
  })

  it('ignores repeated auto-sync starts while already scheduled', async () => {
    await startNutstoreAutoSync()
    await startNutstoreAutoSync()

    expect(mocks.getState).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
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
