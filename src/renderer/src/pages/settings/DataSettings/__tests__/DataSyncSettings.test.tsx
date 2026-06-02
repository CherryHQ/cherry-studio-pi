import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSyncSettings from '../DataSyncSettings'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getStatus: vi.fn(),
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

function runningStatus() {
  return {
    deviceId: 'device-1',
    lastSummary: {
      status: 'success',
      error: null,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      skipped: 0,
      storageUploaded: 0,
      storageDownloaded: 0,
      storageDeleted: 0,
      storageConflicts: 0,
      storageSkipped: 0,
      blobUploaded: 0,
      blobDownloaded: 0,
      snapshotUploaded: false,
      snapshotFileName: null,
      snapshotBytes: 0,
      remotePath: '/cherry-studio-pi/sync/v1',
      lastSyncAt: 0
    },
    conflicts: [],
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
    mocks.getStatus.mockResolvedValue(runningStatus())
    mocks.syncAppDataNow.mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dataSync: {
          checkWriteAccess: vi.fn(),
          getStatus: mocks.getStatus,
          listRemoteDirectories: vi.fn(),
          restoreLatestSnapshot: vi.fn(),
          syncNow: vi.fn()
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: mocks.toast
    })
  })

  it('keeps the sync button busy after remount and does not report success for duplicate clicks', async () => {
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
})
