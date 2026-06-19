import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  removeRestoreProgressListener: vi.fn(),
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => {
    void loading
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  CircularProgress: ({ renderLabel, value }: { renderLabel?: (value: number) => ReactNode; value: number }) => (
    <div>{renderLabel ? renderLabel(value) : value}</div>
  ),
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onPointerDownOutside,
    ...props
  }: {
    children?: ReactNode
    onPointerDownOutside?: unknown
    [key: string]: unknown
  }) => {
    void onPointerDownOutside
    return (
      <div data-testid="dialog-content" {...props}>
        {children}
      </div>
    )
  },
  DialogFooter: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-footer" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-header" {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <h2 data-testid="dialog-title" {...props}>
      {children}
    </h2>
  )
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/i18n/label', () => ({
  getRestoreProgressLabelKey: (stage: string) => `restore.progress.${stage}`
}))

vi.mock('@renderer/services/BackupService', () => ({
  restore: mocks.restore
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    RestoreProgress: 'restore-progress'
  }
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

async function showPopup() {
  const { default: RestorePopup } = await import('../RestorePopup')
  const settled = vi.fn()

  void RestorePopup.show().then(settled)
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
  const renderResult = render(<>{rendered}</>)

  return { RestorePopup, settled, ...renderResult }
}

describe('RestorePopup', () => {
  let previousElectron: unknown

  beforeEach(() => {
    previousElectron = window.electron
    vi.clearAllMocks()
    vi.useFakeTimers()
    window.electron = {
      ...window.electron,
      ipcRenderer: {
        ...window.electron?.ipcRenderer,
        on: vi.fn(() => mocks.removeRestoreProgressListener)
      }
    } as typeof window.electron
  })

  afterEach(() => {
    window.electron = previousElectron as typeof window.electron
    vi.useRealTimers()
    vi.resetModules()
  })

  it('resolves after restore succeeds', async () => {
    const restoreOperation = deferred<void>()
    mocks.restore.mockReturnValue(restoreOperation.promise)
    const { settled } = await showPopup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
      await Promise.resolve()
    })

    await act(async () => {
      restoreOperation.resolve(undefined)
      await restoreOperation.promise
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledWith({})
    expect(mocks.TopView.hide).toHaveBeenCalledWith('RestorePopup')
  })

  it('ignores restore completion after the popup unmounts', async () => {
    const restoreOperation = deferred<void>()
    mocks.restore.mockReturnValue(restoreOperation.promise)
    const { settled, unmount } = await showPopup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
      await Promise.resolve()
    })

    unmount()

    await act(async () => {
      restoreOperation.resolve(undefined)
      await restoreOperation.promise
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).not.toHaveBeenCalled()
    expect(mocks.TopView.hide).not.toHaveBeenCalled()
  })
})
