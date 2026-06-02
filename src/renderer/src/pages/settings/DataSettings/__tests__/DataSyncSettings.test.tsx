import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSyncSettings from '../DataSyncSettings'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getStatus: vi.fn(),
  checkWriteAccess: vi.fn(),
  listRemoteDirectories: vi.fn(),
  restoreLatestSnapshot: vi.fn(),
  startDataSyncAutoSync: vi.fn(),
  stopDataSyncAutoSync: vi.fn(),
  syncAppDataNow: vi.fn(),
  reportErrorToSystemAgent: vi.fn(),
  runtimeState: {
    syncing: false,
    syncStartedAt: null as number | null
  },
  runtimeListeners: new Set<(state: { syncing: boolean; syncStartedAt: number | null }) => void>(),
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
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
  getDataSyncRuntimeState: () => mocks.runtimeState,
  startDataSyncAutoSync: mocks.startDataSyncAutoSync,
  stopDataSyncAutoSync: mocks.stopDataSyncAutoSync,
  subscribeDataSyncRuntimeState: (listener: (state: { syncing: boolean; syncStartedAt: number | null }) => void) => {
    mocks.runtimeListeners.add(listener)
    listener(mocks.runtimeState)

    return () => {
      mocks.runtimeListeners.delete(listener)
    }
  },
  syncAppDataNow: mocks.syncAppDataNow
}))

function syncButton() {
  const button = screen.getByText('settings.data.data_sync.sync').closest('button')
  expect(button).toBeTruthy()
  return button!
}

function successSummary() {
  return {
    status: 'success',
    error: null,
    uploaded: 1,
    downloaded: 2,
    deleted: 0,
    conflicts: 0,
    skipped: 3,
    storageUploaded: 4,
    storageDownloaded: 5,
    storageDeleted: 0,
    storageConflicts: 0,
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
    mocks.runtimeListeners.clear()
    mocks.runtimeState.syncing = false
    mocks.runtimeState.syncStartedAt = null
    mocks.getStatus.mockResolvedValue(idleStatus())
    mocks.checkWriteAccess.mockResolvedValue({ ok: true, basePath: '/cherry-studio-pi/sync/v1' })
    mocks.listRemoteDirectories.mockResolvedValue({ path: '/', parentPath: null, directories: [] })
    mocks.restoreLatestSnapshot.mockResolvedValue(undefined)
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
