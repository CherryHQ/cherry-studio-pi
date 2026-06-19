import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpServerCard from '../McpServerCard'

const mocks = vi.hoisted(() => ({
  deleteMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  ensureServerTrusted: vi.fn(),
  getServerVersion: vi.fn(),
  refreshTools: vi.fn(),
  removeServer: vi.fn()
}))

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

type ConfirmOptions = {
  onOk?: () => Promise<void> | void
  onCancel?: () => void
}

type MockAlertProps = ComponentProps<'div'> & {
  action?: ReactNode
  description?: ReactNode
  message?: ReactNode
}

let latestConfirm: ConfirmOptions | undefined

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ action, description, message, onClick }: PropsWithChildren<MockAlertProps>) => (
    <div onClick={onClick}>
      {message}
      {description}
      {action}
    </div>
  ),
  Badge: ({ children, ...props }: PropsWithChildren<ComponentProps<'span'>>) => <span {...props}>{children}</span>,
  Button: ({
    children,
    disabled,
    loading,
    ...props
  }: PropsWithChildren<ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }>) => {
    const buttonProps = { ...props }
    delete buttonProps.size
    delete buttonProps.variant

    return (
      <button {...buttonProps} disabled={disabled || loading}>
        {children}
      </button>
    )
  },
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: ComponentProps<'button'> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" {...props} onClick={() => onCheckedChange?.(!checked)}>
      switch
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content?: ReactNode }>) => <>{children}</>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/Icons', () => ({
  DeleteIcon: () => <span>delete-icon</span>
}))

vi.mock('@renderer/components/Popups/GeneralPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled', lastError: null })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServerMutations: () => ({
    deleteMcpServer: mocks.deleteMcpServer,
    updateMcpServer: mocks.updateMcpServer
  })
}))

vi.mock('@renderer/hooks/useMcpServerTrust', () => ({
  useMcpServerTrust: () => ({
    ensureServerTrusted: mocks.ensureServerTrusted
  })
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  formatMcpError: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

vi.mock('@renderer/utils/openExternal', () => ({
  openHttpExternalUrl: vi.fn()
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('lucide-react', () => ({
  CircleXIcon: () => <span />,
  SquareArrowOutUpRight: () => <span />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function renderCard() {
  return render(
    <McpServerCard
      isEditing
      onEdit={vi.fn()}
      server={{
        id: 'server-1',
        name: 'Demo MCP',
        type: 'stdio',
        command: 'demo',
        args: [],
        env: {},
        isActive: false,
        installSource: 'manual'
      }}
    />
  )
}

async function openDeleteConfirm() {
  const deleteButton = screen.getByText('delete-icon').closest('button')
  expect(deleteButton).toBeTruthy()
  fireEvent.click(deleteButton!)
  await waitFor(() => expect(window.modal.confirm).toHaveBeenCalledTimes(1))
  expect(latestConfirm?.onOk).toBeTypeOf('function')
}

describe('McpServerCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestConfirm = undefined
    mocks.getServerVersion.mockResolvedValue(null)
    mocks.removeServer.mockResolvedValue(undefined)
    mocks.deleteMcpServer.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mcp: {
          getServerVersion: mocks.getServerVersion,
          refreshTools: mocks.refreshTools,
          removeServer: mocks.removeServer
        }
      }
    })

    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: vi.fn((options: ConfirmOptions) => {
          latestConfirm = options
        }),
        error: vi.fn()
      }
    })

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('ignores successful delete notifications after unmount', async () => {
    const removeResult = deferred<void>()
    mocks.removeServer.mockReturnValue(removeResult.promise)

    const { unmount } = renderCard()
    await openDeleteConfirm()

    let deletePromise!: Promise<void> | void
    await act(async () => {
      deletePromise = latestConfirm!.onOk!()
      await Promise.resolve()
    })
    await waitFor(() => expect(mocks.removeServer).toHaveBeenCalledWith('server-1'))
    unmount()

    await act(async () => {
      removeResult.resolve()
      await deletePromise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('ignores failed delete notifications after unmount', async () => {
    const removeResult = deferred<void>()
    mocks.removeServer.mockReturnValue(removeResult.promise)

    const { unmount } = renderCard()
    await openDeleteConfirm()

    let deletePromise!: Promise<void> | void
    await act(async () => {
      deletePromise = latestConfirm!.onOk!()
      await Promise.resolve()
    })
    await waitFor(() => expect(mocks.removeServer).toHaveBeenCalledWith('server-1'))
    unmount()

    await act(async () => {
      removeResult.reject(new Error('delete failed after unmount'))
      await expect(deletePromise).rejects.toThrow('delete failed after unmount')
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
