import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppInit } from '../useAppInit'

const mocks = vi.hoisted(() => ({
  cacheSet: vi.fn(),
  checkForUpdate: vi.fn(),
  getAppInfo: vi.fn(),
  getDataPathFromArgs: vi.fn(),
  installStorageV2RuntimeMirrors: vi.fn(),
  loggerWarn: vi.fn(),
  preferences: {
    'app.dist.auto_update.enabled': true,
    'app.language': 'en-US',
    'app.privacy.data_collection.enabled': false,
    'ui.custom_css': '',
    'ui.window_style': 'default'
  } as Record<string, unknown>,
  settings: {
    dataSyncAutoSync: false,
    dataSyncSyncInterval: 0,
    dataSyncWebdavHost: '',
    dataSyncWebdavPass: '',
    dataSyncWebdavUser: ''
  },
  startDataSyncAutoSync: vi.fn(),
  startDataSyncExternalSyncListener: vi.fn(),
  setDayjsLocale: vi.fn(),
  stopDataSyncAutoSync: vi.fn(),
  stopDataSyncExternalSyncListener: vi.fn(),
  updateAppUpdateState: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    set: mocks.cacheSet
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key]]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mocks.loggerWarn
    })
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/databases', () => ({
  default: {
    settings: {
      get: vi.fn()
    }
  }
}))

vi.mock('@renderer/hooks/useAppUpdate', () => ({
  useAppUpdateHandler: vi.fn(),
  useAppUpdateState: () => ({
    updateAppUpdateState: mocks.updateAppUpdateState
  })
}))

vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({
  useStorageMonitorNotification: vi.fn()
}))

vi.mock('@renderer/services/DataSyncService', () => ({
  startDataSyncAutoSync: mocks.startDataSyncAutoSync,
  startDataSyncExternalSyncListener: mocks.startDataSyncExternalSyncListener,
  stopDataSyncExternalSyncListener: mocks.stopDataSyncExternalSyncListener,
  stopDataSyncAutoSync: mocks.stopDataSyncAutoSync
}))

vi.mock('@renderer/services/StorageV2Service', () => ({
  installStorageV2RuntimeMirrors: mocks.installStorageV2RuntimeMirrors
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: { settings: typeof mocks.settings }) => unknown) =>
    selector({ settings: mocks.settings })
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    changeLanguage: vi.fn()
  },
  setDayjsLocale: mocks.setDayjsLocale
}))

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: vi.fn()
}))

vi.mock('../useFullScreenNotice', () => ({
  default: vi.fn()
}))

vi.mock('../useMiniApps', () => ({
  useMiniApps: () => ({ miniAppShow: false })
}))

vi.mock('../useNavBackgroundColor', () => ({
  default: () => 'transparent'
}))

vi.mock('../useNavbar', () => ({
  useNavbarPosition: () => ({ isLeftNavbar: true })
}))

const flushMicrotasks = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(() => resolve())
  })

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function installWindowApi() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      checkForUpdate: mocks.checkForUpdate,
      getAppInfo: mocks.getAppInfo,
      getDataPathFromArgs: mocks.getDataPathFromArgs
    }
  })
  Object.defineProperty(window, 'navigate', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(window, 'root', {
    configurable: true,
    value: document.createElement('div')
  })
}

describe('useAppInit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.settings = {
      dataSyncAutoSync: false,
      dataSyncSyncInterval: 0,
      dataSyncWebdavHost: '',
      dataSyncWebdavPass: '',
      dataSyncWebdavUser: ''
    }
    mocks.preferences = {
      'app.dist.auto_update.enabled': true,
      'app.language': 'en-US',
      'app.privacy.data_collection.enabled': false,
      'ui.custom_css': '',
      'ui.window_style': 'default'
    }
    vi.spyOn(console, 'timeEnd').mockImplementation(() => undefined)
    mocks.getDataPathFromArgs.mockResolvedValue(null)
    mocks.getAppInfo.mockResolvedValue({
      filesPath: '/tmp/files',
      isPackaged: true,
      resourcesPath: '/tmp/resources'
    })
    mocks.checkForUpdate.mockResolvedValue({ updateInfo: { version: '1.0.0' } })
    installWindowApi()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('installs Storage v2 runtime mirrors when the main view initializes', () => {
    renderHook(() => useAppInit())

    expect(mocks.installStorageV2RuntimeMirrors).toHaveBeenCalledTimes(1)
  })

  it('cancels the delayed auto-update check on unmount', async () => {
    const { unmount } = renderHook(() => useAppInit())
    await flushMicrotasks()

    expect(mocks.getAppInfo).toHaveBeenCalledTimes(1)

    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    await flushMicrotasks()

    expect(mocks.getAppInfo).toHaveBeenCalledTimes(1)
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(mocks.updateAppUpdateState).not.toHaveBeenCalled()
  })

  it('does not register update-check timers when auto update checks are disabled', async () => {
    mocks.preferences['app.dist.auto_update.enabled'] = false

    renderHook(() => useAppInit())
    await flushMicrotasks()

    expect(mocks.getAppInfo).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    })
    await flushMicrotasks()

    expect(mocks.getAppInfo).toHaveBeenCalledTimes(1)
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(mocks.updateAppUpdateState).not.toHaveBeenCalled()
  })

  it('does not navigate when launch data path resolves after unmount', async () => {
    const launchDataPath = deferred<string | null>()
    mocks.getDataPathFromArgs.mockReturnValueOnce(launchDataPath.promise)

    const { unmount } = renderHook(() => useAppInit())
    unmount()

    await act(async () => {
      launchDataPath.resolve('/tmp/custom-data')
      await launchDataPath.promise
    })

    expect(window.navigate).not.toHaveBeenCalled()
  })

  it('does not cache app paths when app info resolves after unmount', async () => {
    const appInfo = deferred<{ filesPath: string; isPackaged: boolean; resourcesPath: string }>()
    mocks.getAppInfo.mockReturnValueOnce(appInfo.promise)

    const { unmount } = renderHook(() => useAppInit())
    unmount()

    await act(async () => {
      appInfo.resolve({
        filesPath: '/tmp/files',
        isPackaged: true,
        resourcesPath: '/tmp/resources'
      })
      await appInfo.promise
    })

    expect(mocks.cacheSet).not.toHaveBeenCalledWith('app.path.files', '/tmp/files')
    expect(mocks.cacheSet).not.toHaveBeenCalledWith('app.path.resources', '/tmp/resources')
  })

  it('does not update state when an in-flight update check finishes after unmount', async () => {
    let resolveUpdate!: (value: { updateInfo: { version: string } }) => void
    mocks.checkForUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        })
    )

    const { unmount } = renderHook(() => useAppInit())

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    await flushMicrotasks()

    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1)

    unmount()
    resolveUpdate({ updateInfo: { version: '1.0.1' } })
    await flushMicrotasks()

    expect(mocks.updateAppUpdateState).not.toHaveBeenCalled()
  })

  it('starts WebDAV auto sync from app init when the saved config is complete', () => {
    mocks.settings = {
      dataSyncAutoSync: true,
      dataSyncSyncInterval: 15,
      dataSyncWebdavHost: 'https://dav.example.test',
      dataSyncWebdavPass: 'pass',
      dataSyncWebdavUser: 'user'
    }

    const { unmount } = renderHook(() => useAppInit())

    expect(mocks.startDataSyncAutoSync).toHaveBeenCalledWith(false)
    expect(mocks.stopDataSyncAutoSync).not.toHaveBeenCalled()

    unmount()
    expect(mocks.stopDataSyncAutoSync).toHaveBeenCalledTimes(1)
  })

  it('starts the external data sync completion listener from app init', () => {
    const { unmount } = renderHook(() => useAppInit())

    expect(mocks.startDataSyncExternalSyncListener).toHaveBeenCalledTimes(1)
    expect(mocks.stopDataSyncExternalSyncListener).not.toHaveBeenCalled()

    unmount()
    expect(mocks.stopDataSyncExternalSyncListener).toHaveBeenCalledTimes(1)
  })

  it('stops WebDAV auto sync from app init when saved credentials are incomplete', () => {
    mocks.settings = {
      dataSyncAutoSync: true,
      dataSyncSyncInterval: 15,
      dataSyncWebdavHost: 'https://dav.example.test',
      dataSyncWebdavPass: '',
      dataSyncWebdavUser: 'user'
    }

    const { unmount } = renderHook(() => useAppInit())

    expect(mocks.startDataSyncAutoSync).not.toHaveBeenCalled()
    expect(mocks.stopDataSyncAutoSync).toHaveBeenCalledTimes(1)

    unmount()
  })
})
