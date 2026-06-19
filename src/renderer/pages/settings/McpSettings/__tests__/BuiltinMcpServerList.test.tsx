import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BuiltinMcpServerList from '../BuiltinMcpServerList'

const mocks = vi.hoisted(() => ({
  addMcpServer: vi.fn()
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
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
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
      <button {...buttonProps} disabled={disabled || loading}>
        {children}
      </button>
    )
  },
  Popover: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({
    children,
    value: _value,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>) => {
    void _value

    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  }
}))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} />
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({
    addMcpServer: mocks.addMcpServer,
    mcpServers: []
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getBuiltInMcpServerDescriptionLabelKey: (name: string) => `description.${name}`
}))

vi.mock('@renderer/store/mcp', () => ({
  builtinMcpServers: [
    {
      id: 'builtin-demo',
      name: 'Demo MCP',
      type: 'stdio',
      command: 'demo-mcp',
      args: [],
      env: {},
      isActive: true,
      installSource: 'builtin'
    }
  ]
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('..', () => ({
  SettingTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
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

describe('BuiltinMcpServerList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('ignores successful add notifications after unmount', async () => {
    const addResult = deferred<void>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<BuiltinMcpServerList />)
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.skills.install' }).at(-1)!)

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      addResult.resolve()
      await addResult.promise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('ignores failed add notifications after unmount', async () => {
    const addResult = deferred<void>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<BuiltinMcpServerList />)
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.skills.install' }).at(-1)!)

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
