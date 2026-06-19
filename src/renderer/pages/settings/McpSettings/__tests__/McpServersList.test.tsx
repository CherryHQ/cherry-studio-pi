import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpServersList from '../McpServersList'

const mocks = vi.hoisted(() => ({
  addMcpServer: vi.fn(),
  navigate: vi.fn(),
  reorderMcpServers: vi.fn()
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
  EmptyState: ({ description }: { description: string }) => <div>{description}</div>,
  MenuItem: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  MenuList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Popover: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Sortable: () => <div data-testid="sortable" />,
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
  },
  useDndReorder: () => ({
    onSortEnd: vi.fn()
  })
}))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} />
}))

vi.mock('@renderer/components/Icons', () => ({
  EditIcon: () => <span />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: vi.fn(({ children }: React.PropsWithChildren, ref: React.Ref<HTMLDivElement>) => (
    <div ref={ref}>{children}</div>
  ))
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({
    addMcpServer: mocks.addMcpServer,
    mcpServers: [],
    reorderMcpServers: mocks.reorderMcpServers
  })
}))

vi.mock('@renderer/utils/match', () => ({
  matchKeywordsInString: () => true
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate
}))

vi.mock('..', () => ({
  SettingTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('../AddMcpServerModal', () => ({
  default: ({ onSuccess, visible }: { onSuccess: (dto: { name: string }) => Promise<unknown>; visible: boolean }) =>
    visible ? (
      <button type="button" onClick={() => void onSuccess({ name: 'Imported MCP' })}>
        add-imported-server
      </button>
    ) : null
}))

vi.mock('../EnvironmentDependencies', () => ({
  default: () => <div />
}))

vi.mock('../mcpScrollStorage', () => ({
  readMcpListScrollTop: () => null,
  writeMcpListScrollTop: vi.fn()
}))

vi.mock('../McpServerCard', () => ({
  default: () => <div />
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

describe('McpServersList', () => {
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

  it('does not navigate or toast after manual add resolves post-unmount', async () => {
    const addResult = deferred<{ id: string }>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<McpServersList />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.mcp.addServer.create' }))

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      addResult.resolve({ id: 'server-after-unmount' })
      await addResult.promise
    })

    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not toast after imported add resolves post-unmount', async () => {
    const addResult = deferred<{ id: string }>()
    mocks.addMcpServer.mockReturnValue(addResult.promise)

    const { unmount } = render(<McpServersList />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.mcp.addServer.importFrom.json' }))
    fireEvent.click(screen.getByRole('button', { name: 'add-imported-server' }))

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      addResult.resolve({ id: 'imported-after-unmount' })
      await addResult.promise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
