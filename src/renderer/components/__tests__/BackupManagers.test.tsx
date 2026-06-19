import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalBackupManager } from '../LocalBackupManager'
import { S3BackupManager } from '../S3BackupManager'
import { WebdavBackupManager } from '../WebdavBackupManager'

const mocks = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) =>
    options && 'count' in options ? `${key}:${options.count}` : key
}))

vi.mock('@cherrystudio/ui', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: ReactNode }) => <div data-testid={testId}>{children}</div>

  return {
    Button: ({ children, disabled, onClick, ...props }: any) => (
      <button type="button" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    DataTable: ({ columns, data }: any) => (
      <div data-testid="data-table">
        {data.map((row: any) => (
          <div key={row.fileName}>
            {columns.map((column: any) => {
              const content = column.cell
                ? column.cell({
                    getValue: () => (column.accessorKey ? row[column.accessorKey] : undefined),
                    row: { original: row }
                  })
                : column.accessorKey
                  ? row[column.accessorKey]
                  : null

              return <div key={column.id || column.accessorKey}>{content}</div>
            })}
          </div>
        ))}
      </div>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: passthrough('dialog-content'),
    DialogFooter: passthrough('dialog-footer'),
    DialogHeader: passthrough('dialog-header'),
    DialogTitle: passthrough('dialog-title'),
    Flex: passthrough('flex'),
    Spinner: ({ text }: { text?: string }) => <div>{text}</div>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('@renderer/services/BackupService', () => ({
  restoreFromLocal: vi.fn(),
  restoreFromS3: vi.fn(),
  restoreFromWebdav: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: (size: number) => `${size} B`
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: mocks.t
  })
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const backupFile = {
  fileName: 'backup.zip',
  modifiedTime: '2026-06-19T00:00:00.000Z',
  size: 1024
}

function setupWindowMocks() {
  Object.defineProperty(window, 'toast', {
    configurable: true,
    value: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  })

  Object.defineProperty(window, 'modal', {
    configurable: true,
    value: {
      confirm: vi.fn()
    }
  })

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      backup: {
        deleteLocalBackupFile: vi.fn(),
        deleteS3File: vi.fn(),
        deleteWebdavFile: vi.fn(),
        listLocalBackupFiles: vi.fn(),
        listS3Files: vi.fn(),
        listWebdavFiles: vi.fn()
      }
    }
  })
}

describe('backup managers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupWindowMocks()
  })

  it('ignores stale local delete completion after unmount', async () => {
    const deleteOperation = deferred<void>()
    vi.mocked(window.api.backup.listLocalBackupFiles).mockResolvedValue([backupFile])
    vi.mocked(window.api.backup.deleteLocalBackupFile).mockReturnValue(deleteOperation.promise)

    const { unmount } = render(<LocalBackupManager visible onClose={vi.fn()} localBackupDir="/tmp/backups" />)
    await screen.findByText('backup.zip')

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.local.backup.manager.delete.text' }))
    const onOk = vi.mocked(window.modal.confirm).mock.calls[0][0].onOk as () => Promise<void>

    let operationPromise!: Promise<void>
    act(() => {
      operationPromise = onOk()
    })

    expect(window.api.backup.deleteLocalBackupFile).toHaveBeenCalledWith('backup.zip', '/tmp/backups')

    unmount()
    await act(async () => {
      deleteOperation.resolve()
      await operationPromise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(window.api.backup.listLocalBackupFiles).toHaveBeenCalledTimes(1)
  })

  it('ignores stale S3 delete completion after unmount', async () => {
    const deleteOperation = deferred<void>()
    vi.mocked(window.api.backup.listS3Files).mockResolvedValue([backupFile])
    vi.mocked(window.api.backup.deleteS3File).mockReturnValue(deleteOperation.promise)

    const s3Config = {
      endpoint: 'http://127.0.0.1:9000',
      region: 'local',
      bucket: 'backups',
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    }
    const { unmount } = render(<S3BackupManager visible onClose={vi.fn()} s3Config={s3Config} />)
    await screen.findByText('backup.zip')

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.s3.manager.delete.label' }))
    const onOk = vi.mocked(window.modal.confirm).mock.calls[0][0].onOk as () => Promise<void>

    let operationPromise!: Promise<void>
    act(() => {
      operationPromise = onOk()
    })

    expect(window.api.backup.deleteS3File).toHaveBeenCalledWith(
      'backup.zip',
      expect.objectContaining({
        accessKeyId: 'access',
        bucket: 'backups',
        endpoint: 'http://127.0.0.1:9000',
        region: 'local',
        secretAccessKey: 'secret'
      })
    )

    unmount()
    await act(async () => {
      deleteOperation.resolve()
      await operationPromise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(window.api.backup.listS3Files).toHaveBeenCalledTimes(1)
  })

  it('ignores stale WebDAV delete completion after unmount', async () => {
    const deleteOperation = deferred<void>()
    vi.mocked(window.api.backup.listWebdavFiles).mockResolvedValue([backupFile])
    vi.mocked(window.api.backup.deleteWebdavFile).mockReturnValue(deleteOperation.promise)

    const webdavConfig = {
      webdavHost: 'http://127.0.0.1:8080',
      webdavUser: 'webdav',
      webdavPass: 'secret',
      webdavPath: '/dav'
    }
    const { unmount } = render(<WebdavBackupManager visible onClose={vi.fn()} webdavConfig={webdavConfig} />)
    await screen.findByText('backup.zip')

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.webdav.backup.manager.delete.text' }))
    const onOk = vi.mocked(window.modal.confirm).mock.calls[0][0].onOk as () => Promise<void>

    let operationPromise!: Promise<void>
    act(() => {
      operationPromise = onOk()
    })

    expect(window.api.backup.deleteWebdavFile).toHaveBeenCalledWith('backup.zip', {
      webdavHost: 'http://127.0.0.1:8080',
      webdavPass: 'secret',
      webdavPath: '/dav',
      webdavUser: 'webdav'
    })

    unmount()
    await act(async () => {
      deleteOperation.resolve()
      await operationPromise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(window.api.backup.listWebdavFiles).toHaveBeenCalledTimes(1)
  })
})
