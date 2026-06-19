import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GeneralPopup from '../GeneralPopup'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  TopView: {
    hide: vi.fn(),
    show: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, loading, onClick, type = 'button', ...props }: any) => (
    <button type={type} disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...items: unknown[]) => items.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe('GeneralPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores an async ok result after the popup unmounts', async () => {
    const runningOk = deferred<void>()
    const onOk = vi.fn(() => runningOk.promise)
    const resolveSpy = vi.fn()

    const popupPromise = GeneralPopup.show({
      title: 'Confirm',
      content: 'Run operation',
      onOk
    })
    void popupPromise.then(resolveSpy)

    const rendered = mocks.TopView.show.mock.calls[0][0] as ReactNode
    const { unmount } = render(<>{rendered}</>)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    })
    expect(onOk).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      runningOk.resolve(undefined)
      await runningOk.promise
    })

    expect(resolveSpy).not.toHaveBeenCalled()
    expect(mocks.TopView.hide).not.toHaveBeenCalled()
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })
})
