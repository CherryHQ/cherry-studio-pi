import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSyncSettings from '../DataSyncSettings'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getStatus: vi.fn(),
  checkWriteAccess: vi.fn(),
  listRemoteDirectories: vi.fn(),
  restoreLatestSnapshot: vi.fn(),
  showInFolder: vi.fn(),
  refreshDataSyncRuntimeStateFromMain: vi.fn(),
  startDataSyncAutoSync: vi.fn(),
  stopDataSyncAutoSync: vi.fn(),
  subscribeDataSyncRuntimeState: vi.fn(),
  syncAppDataNow: vi.fn(),
  reportErrorToSystemAgent: vi.fn(),
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      return `${key}:${JSON.stringify(values)}`
    }
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    dataSyncWebdavHost: 'https://dav.example.test',
    dataSyncWebdavUser: 'user',
    dataSyncWebdavPass: 'pass',
    dataSyncWebdavPath: '/cherry-studio-pi',
    dataSyncSyncInterval: 0
  })
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch
}))

vi.mock('@renderer/services/SystemAgentService', () => ({
  reportErrorToSystemAgent: mocks.reportErrorToSystemAgent
}))

vi.mock('@renderer/services/DataSyncService', () => ({
  refreshDataSyncRuntimeStateFromMain: mocks.refreshDataSyncRuntimeStateFromMain,
  startDataSyncAutoSync: mocks.startDataSyncAutoSync,
  stopDataSyncAutoSync: mocks.stopDataSyncAutoSync,
  subscribeDataSyncRuntimeState: mocks.subscribeDataSyncRuntimeState,
  syncAppDataNow: mocks.syncAppDataNow
}))

function syncButton() {
  const button = screen.getByText('settings.data.data_sync.sync').closest('button')
  expect(button).toBeTruthy()
  return button!
}

function buttonByText(text: string) {
  const button = screen.getByText(text).closest('button')
  expect(button).toBeTruthy()
  return button!
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function successSummary() {
  return {
    status: 'success',
    error: null,
    uploaded: 1,
    downloaded: 2,
    deleted: 0,
    conflicts: 0,
    resolvedConflicts: 1,
    skipped: 3,
    storageUploaded: 4,
    storageDownloaded: 5,
    storageDeleted: 0,
    storageConflicts: 0,
    storageResolvedConflicts: 2,
    storageSkipped: 6,
    blobUploaded: 7,
    blobDownloaded: 8,
    snapshotUploaded: false,
    snapshotFileName: null,
    snapshotBytes: 0,
    remotePath: '/cherry-studio-pi/sync/v1',
    lastSyncAt: 1780058147577
  }
}

function idleStatus() {
  return {
    deviceId: 'device-1',
    lastSummary: {
      ...successSummary(),
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      storageUploaded: 0,
      storageDownloaded: 0,
      storageSkipped: 0,
      blobUploaded: 0,
      blobDownloaded: 0,
      secretUploaded: 0,
      secretDownloaded: 0,
      lastSyncAt: 0
    },
    conflicts: [],
    syncing: false,
    syncStartedAt: null
  }
}

function runningStatus() {
  return {
    ...idleStatus(),
    syncing: true,
    syncStartedAt: 1780058147577
  }
}

describe('DataSyncSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStatus.mockResolvedValue(idleStatus())
    mocks.checkWriteAccess.mockResolvedValue({ ok: true, basePath: '/cherry-studio-pi/sync/v1' })
    mocks.listRemoteDirectories.mockResolvedValue({ path: '/', parentPath: null, directories: [] })
    mocks.restoreLatestSnapshot.mockResolvedValue(undefined)
    mocks.showInFolder.mockResolvedValue(undefined)
    mocks.refreshDataSyncRuntimeStateFromMain.mockResolvedValue({ syncing: false, syncStartedAt: null })
    mocks.subscribeDataSyncRuntimeState.mockImplementation((listener: (state: { syncing: boolean }) => void) => {
      listener({ syncing: false })
      return vi.fn()
    })
    mocks.syncAppDataNow.mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dataSync: {
          checkWriteAccess: mocks.checkWriteAccess,
          getStatus: mocks.getStatus,
          listRemoteDirectories: mocks.listRemoteDirectories,
          restoreLatestSnapshot: mocks.restoreLatestSnapshot,
          syncNow: vi.fn()
        },
        file: {
          showInFolder: mocks.showInFolder
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: mocks.toast
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
    const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window)
    Object.defineProperty(window, 'getComputedStyle', {
      configurable: true,
      writable: true,
      value: (element: Element) => getComputedStyleWithoutPseudo(element)
    })
  })

  it('keeps the sync button busy after remount and does not report success for duplicate clicks', async () => {
    mocks.getStatus.mockResolvedValue(runningStatus())

    const firstRender = render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))
    firstRender.unmount()

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(syncButton()).toHaveClass('ant-btn-loading'))

    fireEvent.click(syncButton())

    expect(mocks.syncAppDataNow).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.info).not.toHaveBeenCalledWith('settings.data.data_sync.toast.sync_success')
  })

  it('clears a stale busy button when status refresh reports the main process is idle', async () => {
    mocks.getStatus.mockResolvedValueOnce(runningStatus()).mockResolvedValueOnce(idleStatus())

    render(<DataSyncSettings />)
    await waitFor(() => expect(syncButton()).toHaveClass('ant-btn-loading'))

    fireEvent.click(screen.getByText('settings.data.data_sync.refresh_status'))

    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
  })

  it('disables sync actions and remote browsing until WebDAV credentials are complete', async () => {
    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('settings.data.data_sync.username_placeholder'), {
      target: { value: '' }
    })

    expect(syncButton()).toBeDisabled()
    expect(buttonByText('settings.data.data_sync.diagnose')).toBeDisabled()
    expect(buttonByText('settings.data.data_sync.restore_latest')).toBeDisabled()
    expect(buttonByText('settings.data.data_sync.remote_path_browse')).toBeDisabled()
  })

  it('ignores stale status refresh responses that arrive after a newer status request', async () => {
    const staleRefresh = deferred<ReturnType<typeof runningStatus>>()
    mocks.getStatus.mockImplementationOnce(() => staleRefresh.promise).mockResolvedValueOnce(idleStatus())

    render(<DataSyncSettings />)
    fireEvent.click(screen.getByText('settings.data.data_sync.refresh_status'))

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))

    staleRefresh.resolve(runningStatus())

    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
  })

  it('does not leave the sync button stuck when status refresh fails', async () => {
    mocks.getStatus.mockResolvedValueOnce(runningStatus()).mockRejectedValueOnce(new Error('status unavailable'))

    render(<DataSyncSettings />)
    await waitFor(() => expect(syncButton()).toHaveClass('ant-btn-loading'))

    fireEvent.click(screen.getByText('settings.data.data_sync.refresh_status'))

    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
    expect(mocks.toast.error).toHaveBeenCalledWith('common.operation_failed: status unavailable')
    expect(mocks.reportErrorToSystemAgent).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'dataSync',
        source: 'settings.data_sync.refresh_status'
      }),
      { showToast: false }
    )
  })

  it('clears stale runtime syncing state when status refresh fails', async () => {
    mocks.getStatus.mockRejectedValue(new Error('status unavailable'))
    mocks.subscribeDataSyncRuntimeState.mockImplementation((listener: (state: { syncing: boolean }) => void) => {
      listener({ syncing: true })
      return vi.fn()
    })

    render(<DataSyncSettings />)

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
  })

  it('treats a null sync summary as an in-flight duplicate instead of success', async () => {
    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() => expect(mocks.syncAppDataNow).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith('settings.data.data_sync.toast.sync_running'))
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('keeps the sync button busy for a null sync summary only while refreshed status is still syncing', async () => {
    mocks.getStatus.mockResolvedValueOnce(idleStatus()).mockResolvedValueOnce(runningStatus())

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(syncButton()).toHaveClass('ant-btn-loading'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('shows an in-flight message without reporting an error when the main process is already syncing', async () => {
    mocks.syncAppDataNow.mockRejectedValueOnce(new Error('同步数据失败：已有数据同步正在进行，请等待本次同步完成。'))

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith('settings.data.data_sync.toast.sync_running'))
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.reportErrorToSystemAgent).not.toHaveBeenCalled()
  })

  it('clears the sync button loading state and reports actionable feedback after real failures', async () => {
    mocks.syncAppDataNow.mockRejectedValueOnce(new Error('同步数据失败：连接 WebDAV 超时，请稍后重试或检查网络。'))

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining('settings.data.data_sync.toast.sync_failed')
      )
    )
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.reportErrorToSystemAgent).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'dataSync',
        source: 'settings.data_sync.sync_now'
      }),
      { showToast: true }
    )
  })

  it('reports success only after syncAppDataNow returns a completed summary', async () => {
    mocks.syncAppDataNow.mockResolvedValueOnce(successSummary())

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('settings.data.data_sync.toast.sync_success'))
    expect(mocks.toast.info).not.toHaveBeenCalledWith('settings.data.data_sync.toast.sync_running')
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('splits a pasted WebDAV account block in the URL field into host username and password', async () => {
    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.paste(screen.getByPlaceholderText('https://example.com/dav'), {
      clipboardData: {
        getData: () => `http://192.168.1.100:8080/

账号：webdav
密码：test-webdav-password`
      }
    })

    expect(screen.getByDisplayValue('http://192.168.1.100:8080')).toBeTruthy()
    expect(screen.getByDisplayValue('webdav')).toBeTruthy()
    expect(screen.getByDisplayValue('test-webdav-password')).toBeTruthy()
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'settings/setDataSyncWebdavHost',
      payload: 'http://192.168.1.100:8080'
    })
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'settings/setDataSyncWebdavUser',
      payload: 'webdav'
    })
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'settings/setDataSyncWebdavPass',
      payload: 'test-webdav-password'
    })
  })

  it('splits WebDAV credentials from URL field changes when Windows does not preserve paste events', async () => {
    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('https://example.com/dav'), {
      target: {
        value: 'http://192.168.1.100:8080/ 账号：webdav 密码：test-webdav-password'
      }
    })

    expect(screen.getByDisplayValue('http://192.168.1.100:8080')).toBeTruthy()
    expect(screen.getByDisplayValue('webdav')).toBeTruthy()
    expect(screen.getByDisplayValue('test-webdav-password')).toBeTruthy()
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'settings/setDataSyncWebdavHost',
      payload: 'http://192.168.1.100:8080'
    })
  })

  it('does not turn a completed sync into a failure when status refresh fails afterward', async () => {
    mocks.getStatus.mockResolvedValueOnce(idleStatus()).mockRejectedValueOnce(new Error('status refresh failed'))
    mocks.syncAppDataNow.mockResolvedValueOnce(successSummary())

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(syncButton())

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('settings.data.data_sync.toast.sync_success'))
    await waitFor(() => expect(syncButton()).not.toHaveClass('ant-btn-loading'))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.reportErrorToSystemAgent).not.toHaveBeenCalled()
  })

  it('keeps long sync result details inside a wrapping summary layout', async () => {
    const longRemotePath = `/dav/${'very-long-directory-name/'.repeat(16)}sync/v1`
    const longError = `WebDAV returned a very long provider message: ${'permission-denied-'.repeat(20)}`
    mocks.getStatus.mockResolvedValueOnce({
      ...idleStatus(),
      lastSummary: {
        ...successSummary(),
        status: 'failed',
        error: longError,
        remotePath: longRemotePath,
        snapshotUploaded: true,
        snapshotFileName: `${'cherry-studio-pi-'.repeat(8)}backup.zip`,
        snapshotBytes: 1024 * 1024
      }
    })

    render(<DataSyncSettings />)

    const result = await screen.findByTestId('data-sync-last-result')
    const metrics = await screen.findByTestId('data-sync-last-result-metrics')
    const errorText = screen.getByText((content) => content.includes(longError))

    expect(result).toHaveStyle('min-width: 0')
    expect(metrics).toHaveStyle('display: grid')
    expect(metrics).toHaveStyle('grid-template-columns: repeat(auto-fit, minmax(132px, 1fr))')
    expect(errorText).toHaveStyle('overflow-wrap: anywhere')
    expect(errorText).toHaveStyle('word-break: break-word')
  })

  it('reveals the local safety snapshot from the last sync result', async () => {
    const snapshotPath = '/tmp/cherry-studio-pi.data-sync.join-safety.device-1.1780058147577.zip'
    mocks.getStatus.mockResolvedValueOnce({
      ...idleStatus(),
      lastSummary: {
        ...successSummary(),
        joinSafetySnapshotCreated: true,
        joinSafetySnapshotFileName: 'cherry-studio-pi.data-sync.join-safety.device-1.1780058147577.zip',
        joinSafetySnapshotPath: snapshotPath,
        joinSafetySnapshotBytes: 2048
      }
    })

    render(<DataSyncSettings />)

    fireEvent.click(await screen.findByLabelText('settings.data.data_sync.snapshot.open_local'))

    expect(mocks.showInFolder).toHaveBeenCalledWith(snapshotPath)
  })

  it('reports local safety snapshot reveal failures to the system agent', async () => {
    const snapshotPath = '/tmp/missing-safety-snapshot.zip'
    mocks.showInFolder.mockRejectedValueOnce(new Error('file missing'))
    mocks.getStatus.mockResolvedValueOnce({
      ...idleStatus(),
      lastSummary: {
        ...successSummary(),
        joinSafetySnapshotCreated: true,
        joinSafetySnapshotFileName: 'missing-safety-snapshot.zip',
        joinSafetySnapshotPath: snapshotPath,
        joinSafetySnapshotBytes: 2048
      }
    })

    render(<DataSyncSettings />)

    fireEvent.click(await screen.findByLabelText('settings.data.data_sync.snapshot.open_local'))

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining('settings.data.data_sync.toast.open_snapshot_failed')
      )
    )
    expect(mocks.reportErrorToSystemAgent).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'dataSync',
        source: 'settings.data_sync.open_local_safety_snapshot'
      }),
      { showToast: true }
    )
  })

  it('opens the remote directory browser from root so the default sync folder does not have to exist', async () => {
    mocks.listRemoteDirectories.mockResolvedValueOnce({
      path: '/',
      parentPath: null,
      directories: [{ name: 'dav', path: '/dav', modifiedAt: null }]
    })

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))

    await waitFor(() =>
      expect(mocks.listRemoteDirectories).toHaveBeenCalledWith(
        expect.objectContaining({
          webdavHost: 'https://dav.example.test',
          webdavPath: '/cherry-studio-pi'
        }),
        '/'
      )
    )
    expect(await screen.findByText('/dav')).toBeTruthy()
  })

  it('opens the remote directory browser with the normalized current form config', async () => {
    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('https://example.com/dav'), {
      target: {
        value:
          'http://192.168.1.100:8080/%0A%0A%E8%B4%A6%E5%8F%B7%EF%BC%9Awebdav%0A%E5%AF%86%E7%A0%81%EF%BC%9Atest-webdav-password'
      }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.data.data_sync.username_placeholder'), {
      target: { value: 'webdav' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.data.data_sync.password_placeholder'), {
      target: { value: 'test-webdav-password' }
    })
    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))

    await waitFor(() =>
      expect(mocks.listRemoteDirectories).toHaveBeenCalledWith(
        expect.objectContaining({
          webdavHost: 'http://192.168.1.100:8080',
          webdavUser: 'webdav',
          webdavPass: 'test-webdav-password',
          webdavPath: '/cherry-studio-pi'
        }),
        '/'
      )
    )
  })

  it('ignores stale remote directory responses after the user navigates to another folder', async () => {
    const staleDirectory = deferred<{
      path: string
      parentPath: string | null
      directories: Array<{ name: string; path: string; modifiedAt: string | null }>
    }>()
    mocks.listRemoteDirectories
      .mockResolvedValueOnce({
        path: '/',
        parentPath: null,
        directories: [
          { name: 'slow', path: '/slow', modifiedAt: null },
          { name: 'fast', path: '/fast', modifiedAt: null }
        ]
      })
      .mockImplementationOnce(() => staleDirectory.promise)
      .mockResolvedValueOnce({
        path: '/fast',
        parentPath: '/',
        directories: [{ name: 'current', path: '/fast/current', modifiedAt: null }]
      })

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))
    expect(await screen.findByText('/slow')).toBeTruthy()

    fireEvent.click(screen.getByText('slow'))
    fireEvent.click(screen.getByText('fast'))

    expect(await screen.findByText('/fast/current')).toBeTruthy()
    staleDirectory.resolve({
      path: '/slow',
      parentPath: '/',
      directories: [{ name: 'stale', path: '/slow/stale', modifiedAt: null }]
    })

    await waitFor(() => expect(screen.queryByText('/slow/stale')).toBeNull())
    expect(screen.getByText('/fast/current')).toBeTruthy()
  })

  it('cancels pending remote directory loads after the browser is closed', async () => {
    const staleDirectory = deferred<{
      path: string
      parentPath: string | null
      directories: Array<{ name: string; path: string; modifiedAt: string | null }>
    }>()
    mocks.listRemoteDirectories
      .mockResolvedValueOnce({
        path: '/',
        parentPath: null,
        directories: [{ name: 'slow', path: '/slow', modifiedAt: null }]
      })
      .mockImplementationOnce(() => staleDirectory.promise)
      .mockResolvedValueOnce({
        path: '/',
        parentPath: null,
        directories: [{ name: 'fresh', path: '/fresh', modifiedAt: null }]
      })

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))
    expect(await screen.findByText('/slow')).toBeTruthy()

    fireEvent.click(screen.getByText('slow'))
    await waitFor(() => expect(mocks.listRemoteDirectories).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByText('settings.data.data_sync.remote_browser.select_current'))

    staleDirectory.resolve({
      path: '/slow',
      parentPath: '/',
      directories: [{ name: 'stale', path: '/slow/stale', modifiedAt: null }]
    })

    await waitFor(() => expect(screen.queryByText('/slow/stale')).toBeNull())

    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))

    expect(await screen.findByText('/fresh')).toBeTruthy()
    expect(screen.queryByText('/slow/stale')).toBeNull()
  })

  it('shows directory browser failures without leaving the directory loader stuck', async () => {
    mocks.listRemoteDirectories.mockRejectedValueOnce(
      new Error('同步数据失败：当前账号没有访问这个 WebDAV 目录的权限。')
    )

    render(<DataSyncSettings />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('settings.data.data_sync.remote_path_browse'))

    expect(await screen.findByText('settings.data.data_sync.remote_browser.error_title')).toBeTruthy()
    expect(screen.getByText('同步数据失败：当前账号没有访问这个 WebDAV 目录的权限。')).toBeTruthy()
    expect(mocks.reportErrorToSystemAgent).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'dataSync',
        source: 'settings.data_sync.remote_directory_browser'
      }),
      { showToast: true }
    )
  })
})
