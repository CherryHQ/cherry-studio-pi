import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddMcpServerModal from '../AddMcpServerModal'

const mocks = vi.hoisted(() => ({
  checkMcpConnectivity: vi.fn(),
  loggerError: vi.fn(),
  patchData: vi.fn(),
  setTimeoutTimer: vi.fn()
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

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({
      children,
      disabled,
      loading,
      ...props
    }: React.PropsWithChildren<
      React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: string }
    >) => {
      const buttonProps = { ...props }
      delete buttonProps.variant

      return (
        <button {...buttonProps} type={buttonProps.type ?? 'button'} disabled={disabled || loading}>
          {children}
        </button>
      )
    },
    CodeEditor: ({ onChange, value }: { onChange: (value: string) => void; value: string }) => (
      <textarea aria-label="server-config" value={value} onChange={(event) => onChange(event.target.value)} />
    ),
    Dialog: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    DialogFooter: ({ children }: React.PropsWithChildren) => <footer>{children}</footer>,
    DialogHeader: ({ children }: React.PropsWithChildren) => <header>{children}</header>,
    DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
    Dropzone: ({ children }: React.PropsWithChildren) => <div>{children}</div>
  }
})

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    patch: mocks.patchData
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [14]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: mocks.loggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    activeCmTheme: 'light'
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
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

describe('AddMcpServerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkMcpConnectivity.mockRejectedValue(new Error('connection failed after unmount'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mcp: {
          checkMcpConnectivity: mocks.checkMcpConnectivity,
          uploadDxt: vi.fn(),
          uploadMcpb: vi.fn()
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores successful JSON import UI callbacks after unmount', async () => {
    const createServer = deferred<any>()
    const onClose = vi.fn()
    const onSuccess = vi.fn().mockReturnValue(createServer.promise)

    const { unmount } = render(
      <AddMcpServerModal visible onClose={onClose} onSuccess={onSuccess} existingServers={[]} />
    )

    fireEvent.change(screen.getByLabelText('server-config'), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            'demo-server': {
              command: 'node',
              args: ['server.js']
            }
          }
        })
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      createServer.resolve({
        id: 'server-1',
        name: 'demo-server'
      })
      await createServer.promise
    })

    await waitFor(() => expect(mocks.checkMcpConnectivity).toHaveBeenCalledWith('server-1'))
    expect(onClose).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not log raw MCP JSON import text when parsing fails', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(<AddMcpServerModal visible onClose={onClose} onSuccess={onSuccess} existingServers={[]} />)

    fireEvent.change(screen.getByLabelText('server-config'), {
      target: {
        value: '{"mcpServers":{"secret-server":{"headers":{"Authorization":"Bearer sk-secret-token"}}'
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalled())
    expect(screen.getByText('settings.mcp.addServer.importFrom.invalid')).toBeInTheDocument()

    const loggedPayload = JSON.stringify(mocks.loggerError.mock.calls)
    expect(loggedPayload).toContain('trimmedLength')
    expect(loggedPayload).not.toContain('sk-secret-token')
    expect(loggedPayload).not.toContain('Bearer')
  })
})
