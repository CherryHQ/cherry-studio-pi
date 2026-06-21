import '@testing-library/jest-dom/vitest'

import type { OperationResult } from '@shared/config/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UpdateButton from '../UpdateButton'

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

const loggerError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerError
    })
  }
}))

vi.mock('lucide-react', () => ({
  ArrowUpCircle: () => <span data-testid="update-icon" />,
  Loader2: () => <span data-testid="loading-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('UpdateButton', () => {
  const confirmMock = vi.fn()
  const successToast = vi.fn()
  const errorToast = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      api: {
        openclaw: {
          checkUpdate: vi.fn().mockResolvedValue({
            hasUpdate: true,
            currentVersion: '1.0.0',
            latestVersion: '1.1.0'
          }),
          performUpdate: vi.fn().mockResolvedValue({ success: true })
        }
      },
      modal: {
        confirm: confirmMock
      },
      toast: {
        error: errorToast,
        success: successToast
      }
    })
  })

  it('ignores delayed update completion after unmount', async () => {
    const updateOperation = deferred<OperationResult>()
    vi.mocked(window.api.openclaw.performUpdate).mockReturnValueOnce(updateOperation.promise)
    const onUpdateComplete = vi.fn()
    const onUpdatingChange = vi.fn()
    const { unmount } = render(<UpdateButton onUpdateComplete={onUpdateComplete} onUpdatingChange={onUpdatingChange} />)

    await screen.findByText('v1.1.0')
    fireEvent.click(screen.getByText('v1.1.0'))

    const onOk = confirmMock.mock.calls[0]?.[0]?.onOk as (() => void) | undefined
    expect(onOk).toBeTypeOf('function')
    act(() => {
      onOk?.()
    })
    await waitFor(() => expect(window.api.openclaw.performUpdate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onUpdatingChange).toHaveBeenLastCalledWith(true))

    unmount()
    expect(onUpdatingChange).toHaveBeenLastCalledWith(false)

    await act(async () => {
      updateOperation.resolve({ success: true })
      await updateOperation.promise
    })

    expect(successToast).not.toHaveBeenCalled()
    expect(errorToast).not.toHaveBeenCalled()
    expect(onUpdateComplete).not.toHaveBeenCalled()
  })

  it('completes an update even when the global toast bridge is unavailable', async () => {
    Object.assign(window, { toast: undefined })
    const onUpdateComplete = vi.fn()
    const onUpdatingChange = vi.fn()

    render(<UpdateButton onUpdateComplete={onUpdateComplete} onUpdatingChange={onUpdatingChange} />)

    await screen.findByText('v1.1.0')
    fireEvent.click(screen.getByText('v1.1.0'))

    const onOk = confirmMock.mock.calls[0]?.[0]?.onOk as (() => void) | undefined
    expect(onOk).toBeTypeOf('function')

    await act(async () => {
      onOk?.()
    })

    await waitFor(() => expect(window.api.openclaw.performUpdate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onUpdateComplete).toHaveBeenCalledTimes(1))
    expect(onUpdatingChange).toHaveBeenLastCalledWith(false)
  })
})
