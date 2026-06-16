import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocalBackupModal } from '../LocalBackupModals'
import { useS3BackupModal } from '../S3Modals'
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

describe('backup modals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
