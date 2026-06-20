import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NpxSearch from '../NpxSearch'

const mocks = vi.hoisted(() => ({
  addMcpServer: vi.fn(),
  npxFinder: vi.fn()
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <span onClick={onClick}>{children}</span>
  ),
  Button: ({
    children,
    disabled,
    loading,
    ...props
  }: React.PropsWithChildren<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: string; size?: string }
  >) => {
    const buttonProps = { ...props }
    delete buttonProps.variant
    delete buttonProps.size

    return (
      <button {...buttonProps} type={buttonProps.type ?? 'button'} disabled={disabled || loading}>
        {children}
      </button>
    )
  },
  Center: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Flex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  RowFlex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Spinner: ({ text }: { text: string }) => <div>{text}</div>
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({
    addMcpServer: mocks.addMcpServer,
    mcpServers: []
  })
}))

vi.mock('@renderer/utils', () => ({
  getMcpConfigSampleFromReadme: () => undefined
}))

vi.mock('npx-scope-finder', () => ({
  npxFinder: mocks.npxFinder
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

describe('NpxSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.npxFinder.mockResolvedValue([
      {
        description: 'Demo package',
        links: {
          npm: 'https://npm.example.com/demo'
        },
        name: '@scope/demo-server',
        version: '1.0.0'
      }
    ])
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
  })

  it('ignores successful package add notifications after unmount', async () => {
    const addResult = deferred<void>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<NpxSearch />)
    await screen.findByText('demo-server')
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      addResult.resolve()
      await addResult.promise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('ignores failed package add notifications after unmount', async () => {
    const addResult = deferred<void>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<NpxSearch />)
    await screen.findByText('demo-server')
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      addResult.reject(new Error('add failed after unmount'))
      await addResult.promise.catch(() => undefined)
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
