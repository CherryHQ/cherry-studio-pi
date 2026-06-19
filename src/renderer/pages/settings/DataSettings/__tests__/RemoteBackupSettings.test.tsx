import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import S3Settings from '../S3Settings'
import WebDavSettings from '../WebDavSettings'

const mocks = vi.hoisted(() => ({
  openSmartMiniApp: vi.fn(),
  preferenceValues: {} as Record<string, unknown>,
  preferenceSetters: {} as Record<string, ReturnType<typeof vi.fn>>,
  startAutoSync: vi.fn(),
  stopAutoSync: vi.fn()
}))

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function preferenceSetter(key: string) {
  const setter = mocks.preferenceSetters[key] ?? vi.fn().mockResolvedValue(undefined)
  mocks.preferenceSetters[key] = setter
  return setter
}

vi.mock('@ant-design/icons', () => ({
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
  InfoTooltip: ({ content, onClick }: { content: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {content}
    </button>
  ),
  Input: ({
    onBlur,
    onChange,
    placeholder,
    type,
    value
  }: {
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
    value?: string
  }) => <input onBlur={onBlur} onChange={onChange} placeholder={placeholder} type={type} value={value ?? ''} />,
  RowFlex: ({ children }: React.PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  ),
  WarnTooltip: ({ content }: { content: string }) => <span>{content}</span>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferenceValues[key], preferenceSetter(key)]
}))

vi.mock('@renderer/components/Selector', () => ({
  default: ({
    disabled,
    onChange,
    options
  }: {
    disabled?: boolean
    onChange: (value: number) => void
    options: Array<{ label: string; value: number }>
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={`${option.label}-${option.value}`}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/S3BackupManager', () => ({
  S3BackupManager: () => <div data-testid="s3-backup-manager" />
}))

vi.mock('@renderer/components/S3Modals', () => ({
  S3BackupModal: () => <div data-testid="s3-backup-modal" />,
  useS3BackupModal: () => ({
    backuping: false,
    customFileName: '',
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    isModalVisible: false,
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/components/WebdavBackupManager', () => ({
  WebdavBackupManager: () => <div data-testid="webdav-backup-manager" />
}))

vi.mock('@renderer/components/WebdavModals', () => ({
  WebdavBackupModal: () => <div data-testid="webdav-backup-modal" />,
  useWebdavBackupModal: () => ({
    backuping: false,
    customFileName: '',
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    isModalVisible: false,
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'app-logo'
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({
    openSmartMiniApp: mocks.openSmartMiniApp
  })
}))

vi.mock('@renderer/services/BackupService', () => ({
  startAutoSync: mocks.startAutoSync,
  stopAutoSync: mocks.stopAutoSync
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      backup: {
        s3Sync: {
          lastSyncError: null,
          lastSyncTime: null,
          syncing: false
        },
        webdavSync: {
          lastSyncError: null,
          lastSyncTime: null,
          syncing: false
        }
      }
    })
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => `${prefix}: failed`
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

describe('remote backup settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferenceValues = {
      'data.backup.s3.access_key_id': 's3-access-key',
      'data.backup.s3.auto_sync': false,
      'data.backup.s3.bucket': 's3-bucket',
      'data.backup.s3.endpoint': 'https://s3.example.com',
      'data.backup.s3.max_backups': 5,
      'data.backup.s3.region': 'us-east-1',
      'data.backup.s3.root': '/cherry-studio-pi',
      'data.backup.s3.secret_access_key': 's3-secret',
      'data.backup.s3.skip_backup_file': false,
      'data.backup.s3.sync_interval': 0,
      'data.backup.webdav.auto_sync': false,
      'data.backup.webdav.disable_stream': false,
      'data.backup.webdav.host': 'https://dav.example.com',
      'data.backup.webdav.max_backups': 5,
      'data.backup.webdav.pass': 'dav-pass',
      'data.backup.webdav.path': '/cherry-studio-pi',
      'data.backup.webdav.skip_backup_file': false,
      'data.backup.webdav.sync_interval': 0,
      'data.backup.webdav.user': 'dav-user'
    }
    mocks.preferenceSetters = {}

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores stale WebDAV save errors after unmount', async () => {
    const saveOperation = deferred<void>()
    preferenceSetter('data.backup.webdav.max_backups').mockReturnValue(saveOperation.promise)

    const { unmount } = render(<WebDavSettings />)
    fireEvent.click(screen.getByRole('button', { name: '10' }))

    await waitFor(() => expect(preferenceSetter('data.backup.webdav.max_backups')).toHaveBeenCalledWith(10))
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('write failed'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('still shows WebDAV save errors while mounted', async () => {
    const saveOperation = deferred<void>()
    preferenceSetter('data.backup.webdav.max_backups').mockReturnValue(saveOperation.promise)

    render(<WebDavSettings />)
    fireEvent.click(screen.getByRole('button', { name: '10' }))

    await waitFor(() => expect(preferenceSetter('data.backup.webdav.max_backups')).toHaveBeenCalledWith(10))

    await act(async () => {
      saveOperation.reject(new Error('write failed'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).toHaveBeenCalledWith('common.save_failed: failed')
  })

  it('ignores stale S3 save errors after unmount', async () => {
    const saveOperation = deferred<void>()
    preferenceSetter('data.backup.s3.max_backups').mockReturnValue(saveOperation.promise)

    const { unmount } = render(<S3Settings />)
    fireEvent.click(screen.getByRole('button', { name: '10' }))

    await waitFor(() => expect(preferenceSetter('data.backup.s3.max_backups')).toHaveBeenCalledWith(10))
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('write failed'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
