import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocalBackupModal } from '../LocalBackupModals'
import { useS3BackupModal, useS3RestoreModal } from '../S3Modals'
import { useWebdavBackupModal } from '../WebdavModals'

const mocks = vi.hoisted(() => ({
  backupToLocal: vi.fn(),
  backupToS3: vi.fn(),
  backupToWebdav: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/BackupService', () => ({
  backupToLocal: (...args: unknown[]) => mocks.backupToLocal(...args),
  backupToS3: (...args: unknown[]) => mocks.backupToS3(...args),
  backupToWebdav: (...args: unknown[]) => mocks.backupToWebdav(...args)
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

function renderHookHarness(getAction: () => () => Promise<void>): () => Promise<void> {
  let action: () => Promise<void> = async () => {}

  function Harness(): ReactNode {
    action = getAction()
    return null
  }

  render(<Harness />)

  return () => action()
}

function renderS3RestoreHarness(): () => ReturnType<typeof useS3RestoreModal> {
  let restoreModal: ReturnType<typeof useS3RestoreModal>

  function Harness(): ReactNode {
    restoreModal = useS3RestoreModal({
      endpoint: 'http://127.0.0.1:9000',
      region: 'local',
      bucket: 'backups',
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    })
    return null
  }

  render(<Harness />)

  return () => restoreModal
}

function renderUnmountableS3RestoreHarness(): {
  getRestoreModal: () => ReturnType<typeof useS3RestoreModal>
  unmount: () => void
} {
  let restoreModal: ReturnType<typeof useS3RestoreModal>

  function Harness(): ReactNode {
    restoreModal = useS3RestoreModal({
      endpoint: 'http://127.0.0.1:9000',
      region: 'local',
      bucket: 'backups',
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    })
    return null
  }

  const view = render(<Harness />)

  return {
    getRestoreModal: () => restoreModal,
    unmount: view.unmount
  }
}

describe('backup modals', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
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
          restoreFromS3: vi.fn()
        }
      }
    })
  })

  it('prevents duplicate local backups while one backup is pending', async () => {
    const runningBackup = deferred<void>()
    mocks.backupToLocal.mockReturnValueOnce(runningBackup.promise)
    const handleBackup = renderHookHarness(() => useLocalBackupModal('/tmp/backups').handleBackup)

    await act(async () => {
      void handleBackup()
      void handleBackup()
    })

    expect(mocks.backupToLocal).toHaveBeenCalledTimes(1)

    await act(async () => {
      runningBackup.resolve()
      await runningBackup.promise
    })
  })

  it('prevents duplicate WebDAV backups while one backup is pending', async () => {
    const runningBackup = deferred<void>()
    mocks.backupToWebdav.mockReturnValueOnce(runningBackup.promise)
    const handleBackup = renderHookHarness(() => useWebdavBackupModal().handleBackup)

    await act(async () => {
      void handleBackup()
      void handleBackup()
    })

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(1)

    await act(async () => {
      runningBackup.resolve()
      await runningBackup.promise
    })
  })

  it('prevents duplicate S3 backups while one backup is pending', async () => {
    const runningBackup = deferred<void>()
    mocks.backupToS3.mockReturnValueOnce(runningBackup.promise)
    const handleBackup = renderHookHarness(() => useS3BackupModal().handleBackup)

    await act(async () => {
      void handleBackup()
      void handleBackup()
    })

    expect(mocks.backupToS3).toHaveBeenCalledTimes(1)

    await act(async () => {
      runningBackup.resolve()
      await runningBackup.promise
    })
  })

  it('prevents duplicate S3 restores while one restore is pending', async () => {
    const runningRestore = deferred<void>()
    vi.mocked(window.api.backup.restoreFromS3).mockReturnValueOnce(runningRestore.promise)
    const getRestoreModal = renderS3RestoreHarness()

    await act(async () => {
      getRestoreModal().setSelectedFile('backup.zip')
    })

    await act(async () => {
      await getRestoreModal().handleRestore()
    })

    const onOk = vi.mocked(window.modal.confirm).mock.calls[0][0].onOk!
    await act(async () => {
      void onOk()
      void onOk()
    })

    expect(window.api.backup.restoreFromS3).toHaveBeenCalledTimes(1)

    await act(async () => {
      runningRestore.resolve()
      await runningRestore.promise
    })
  })

  it('ignores S3 restore confirmation after the modal owner unmounts', async () => {
    vi.mocked(window.api.backup.restoreFromS3).mockResolvedValue(undefined)
    const { getRestoreModal, unmount } = renderUnmountableS3RestoreHarness()

    await act(async () => {
      getRestoreModal().setSelectedFile('backup.zip')
    })

    await act(async () => {
      await getRestoreModal().handleRestore()
    })

    const onOk = vi.mocked(window.modal.confirm).mock.calls[0][0].onOk!
    unmount()

    await act(async () => {
      await onOk()
    })

    expect(window.api.backup.restoreFromS3).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
