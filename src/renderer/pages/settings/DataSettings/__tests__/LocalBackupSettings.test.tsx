import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalBackupSettings from '../LocalBackupSettings'

const mocks = vi.hoisted(() => ({
  preferenceValues: {} as Record<string, unknown>,
  preferenceSetters: {} as Record<string, ReturnType<typeof vi.fn>>,
  getAppInfo: vi.fn(),
  hasWritePermission: vi.fn(),
  isPathInside: vi.fn(),
  resolvePath: vi.fn(),
  select: vi.fn(),
  startAutoSync: vi.fn(),
  stopAutoSync: vi.fn()
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function preferenceSetter(key: string) {
  const setter = mocks.preferenceSetters[key] ?? vi.fn().mockResolvedValue(undefined)
  mocks.preferenceSetters[key] = setter
  return setter
}

vi.mock('@ant-design/icons', () => ({
  DeleteOutlined: () => <span />,
  FolderOpenOutlined: () => <span />,
  SaveOutlined: () => <span />,
  SyncOutlined: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    variant: _variant
  }: React.PropsWithChildren<{
    disabled?: boolean
    onClick?: () => void
    variant?: string
  }>) => {
    void _variant

    return (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    )
  },
  Input: ({
    onBlur,
    onChange,
    placeholder,
    value
  }: {
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    value?: string
  }) => <input onBlur={onBlur} onChange={onChange} placeholder={placeholder} value={value ?? ''} />,
  RowFlex: ({ children }: React.PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  ),
  WarnTooltip: ({ content }: { content: string }) => <span>{content}</span>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferenceValues[key], preferenceSetter(key)]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/LocalBackupManager', () => ({
  LocalBackupManager: () => <div data-testid="local-backup-manager" />
}))

vi.mock('@renderer/components/LocalBackupModals', () => ({
  LocalBackupModal: () => <div data-testid="local-backup-modal" />,
  useLocalBackupModal: () => ({
    backuping: false,
    customFileName: '',
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    isModalVisible: false,
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/components/Selector', () => ({
  default: ({
    disabled,
    onChange,
    value
  }: {
    disabled?: boolean
    onChange: (value: number) => void
    value: number
  }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(value)}>
      selector
    </button>
  )
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/services/BackupService', () => ({
  startAutoSync: mocks.startAutoSync,
  stopAutoSync: mocks.stopAutoSync
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      backup: {
        localBackupSync: {
          lastSyncError: null,
          lastSyncTime: null,
          syncing: false
        }
      }
    })
}))

vi.mock('../..', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: React.PropsWithChildren<{ theme?: string }>) => <section>{children}</section>,
  SettingHelpText: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  SettingRow: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const appInfo = {
  appDataPath: '/app-data',
  installPath: '/Applications/Cherry Studio Pi.app'
}

describe('LocalBackupSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferenceValues = {
      'data.backup.local.auto_sync': false,
      'data.backup.local.dir': '',
      'data.backup.local.max_backups': 5,
      'data.backup.local.skip_backup_file': false,
      'data.backup.local.sync_interval': 0
    }
    mocks.preferenceSetters = {}
    mocks.getAppInfo.mockResolvedValue(appInfo)
    mocks.hasWritePermission.mockResolvedValue(true)
    mocks.isPathInside.mockResolvedValue(false)
    mocks.resolvePath.mockImplementation((value: string) => Promise.resolve(`/resolved${value}`))

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getAppInfo: mocks.getAppInfo,
        hasWritePermission: mocks.hasWritePermission,
        isPathInside: mocks.isPathInside,
        resolvePath: mocks.resolvePath,
        select: mocks.select
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores a selected backup directory after unmount', async () => {
    const selectedDirectory = deferred<string | null>()
    mocks.select.mockReturnValue(selectedDirectory.promise)

    const { unmount } = render(<LocalBackupSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'common.browse' }))

    await waitFor(() => expect(mocks.select).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      selectedDirectory.resolve('/backup')
      await selectedDirectory.promise
    })

    expect(preferenceSetter('data.backup.local.dir')).not.toHaveBeenCalled()
    expect(preferenceSetter('data.backup.local.auto_sync')).not.toHaveBeenCalled()
    expect(mocks.startAutoSync).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('keeps the latest backup directory change when an older validation resolves later', async () => {
    const slowResolve = deferred<string>()
    mocks.resolvePath.mockImplementation((value: string) => {
      if (value === '/slow') {
        return slowResolve.promise
      }

      return Promise.resolve(`/resolved${value}`)
    })

    render(<LocalBackupSettings />)
    const input = screen.getByPlaceholderText('settings.data.local.directory.placeholder')

    fireEvent.blur(input, { target: { value: '/slow' } })
    await waitFor(() => expect(mocks.resolvePath).toHaveBeenCalledWith('/slow'))

    fireEvent.blur(input, { target: { value: '/fast' } })
    await waitFor(() => expect(preferenceSetter('data.backup.local.dir')).toHaveBeenCalledWith('/fast'))

    await act(async () => {
      slowResolve.resolve('/resolved/slow')
      await slowResolve.promise
    })

    expect(preferenceSetter('data.backup.local.dir')).toHaveBeenCalledTimes(1)
    expect(preferenceSetter('data.backup.local.auto_sync')).toHaveBeenCalledWith(true)
    expect(mocks.startAutoSync).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoSync).toHaveBeenCalledWith(true, 'local')
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
