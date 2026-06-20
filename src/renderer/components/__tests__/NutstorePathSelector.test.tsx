import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NutstorePathSelector } from '../NutstorePathSelector'

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

const modalError = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  RowFlex: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons/NutstoreIcons', () => ({
  FolderIcon: ({ className }: { className?: string }) => <span className={className} data-testid="folder-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const folder = (basename: string, path: string): Nutstore.FileStat =>
  ({
    basename,
    isDir: true,
    path
  }) as Nutstore.FileStat

describe('NutstorePathSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      modal: {
        error: modalError
      }
    })
  })

  it('ignores stale directory results after navigating away', async () => {
    const rootFirst = deferred<Nutstore.FileStat[]>()
    const alphaList = deferred<Nutstore.FileStat[]>()
    const rootSecond = deferred<Nutstore.FileStat[]>()
    const fs = {
      ls: vi
        .fn()
        .mockReturnValueOnce(rootFirst.promise)
        .mockReturnValueOnce(alphaList.promise)
        .mockReturnValueOnce(rootSecond.promise),
      mkdirs: vi.fn()
    } as unknown as Nutstore.Fs

    render(<NutstorePathSelector fs={fs} onCancel={vi.fn()} onConfirm={vi.fn()} />)

    await act(async () => {
      rootFirst.resolve([folder('alpha', '/alpha')])
      await rootFirst.promise
    })
    expect(screen.getByText('alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByText('alpha'))
    await waitFor(() => expect(screen.queryByText('alpha')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('settings.data.nutstore.pathSelector.return'))
    await act(async () => {
      rootSecond.resolve([folder('root-again', '/root-again')])
      await rootSecond.promise
    })
    expect(screen.getByText('root-again')).toBeInTheDocument()

    await act(async () => {
      alphaList.resolve([folder('stale-child', '/alpha/stale-child')])
      await alphaList.promise
    })

    expect(screen.queryByText('stale-child')).not.toBeInTheDocument()
    expect(screen.getByText('root-again')).toBeInTheDocument()
  })
})
