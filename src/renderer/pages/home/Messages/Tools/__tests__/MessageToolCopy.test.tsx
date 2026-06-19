import type { McpToolResponse, NormalToolResponse } from '@renderer/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MessageMcpTool from '../MessageMcpTool'
import MessageMetaTool from '../MessageMetaTool'

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  ipcUnsubscribe: vi.fn(),
  loggerError: vi.fn(),
  setTimeoutTimer: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('@cherrystudio/ui', () => ({
  Flex: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => (key === 'chat.message.font_size' ? [14] : ['sans'])
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon" />
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useIsToolAutoApproved: () => false
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('../hooks/useToolApproval', () => ({
  useToolApproval: () => ({
    isExecuting: false,
    isWaiting: false,
    deny: vi.fn(),
    approve: vi.fn(),
    remember: false,
    setRemember: vi.fn()
  })
}))

vi.mock('../ToolApprovalActions', () => ({
  default: () => <div data-testid="tool-approval-actions" />
}))

vi.mock('../chooseTool', () => ({
  chooseTool: () => null
}))

vi.mock('antd', () => ({
  Collapse: ({ items }: { items?: Array<{ key: string; label: React.ReactNode }> }) => (
    <div>
      {items?.map((item) => (
        <div key={item.key}>{item.label}</div>
      ))}
    </div>
  ),
  ConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Flex: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Progress: () => <span data-testid="progress" />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Check: () => <span data-testid="check-icon" />,
    ChevronRight: () => <span data-testid="chevron-icon" />,
    CornerDownRight: () => <span data-testid="corner-icon" />,
    ShieldCheck: () => <span data-testid="shield-icon" />
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const setupGlobals = () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: mocks.clipboardWriteText
    }
  })
  Object.defineProperty(window, 'toast', {
    configurable: true,
    value: {
      error: mocks.toastError,
      success: mocks.toastSuccess
    }
  })
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      ipcRenderer: {
        on: vi.fn(() => mocks.ipcUnsubscribe)
      }
    }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      mcp: {
        abortTool: vi.fn()
      }
    }
  })
}

const createMcpToolResponse = (): McpToolResponse =>
  ({
    id: 'mcp-tool-1',
    tool: {
      id: 'filesystem.read',
      name: 'read',
      description: 'Read file',
      inputSchema: { type: 'object' },
      type: 'mcp',
      serverId: 'filesystem',
      serverName: 'Filesystem'
    },
    arguments: { path: '/tmp/a.txt' },
    response: { content: 'ok' },
    status: 'done',
    toolCallId: 'call-1'
  }) as McpToolResponse

const createMetaToolResponse = (): NormalToolResponse =>
  ({
    id: 'meta-tool-1',
    tool: {
      id: 'tool_search',
      name: 'tool_search',
      description: 'Search tools',
      type: 'provider'
    },
    arguments: { query: 'backup' },
    response: { matchedNamespaces: [] },
    status: 'done',
    toolCallId: 'call-2'
  }) as NormalToolResponse

describe('message tool copy actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupGlobals()
  })

  it('shows copy failure feedback for MCP tool responses', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))

    render(<MessageMcpTool toolResponse={createMcpToolResponse()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: clipboard unavailable')
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalled()
  })

  it('ignores MCP tool copy failures after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.clipboardWriteText.mockReturnValueOnce(clipboardOperation.promise)

    const { unmount } = render(<MessageMcpTool toolResponse={createMcpToolResponse()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.reject(new Error('clipboard unavailable after unmount'))
      await clipboardOperation.promise.catch(() => undefined)
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalled()
  })

  it('shows copy failure feedback for meta tool responses', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))

    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: clipboard unavailable')
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalled()
  })

  it('ignores meta tool copy failures after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.clipboardWriteText.mockReturnValueOnce(clipboardOperation.promise)

    const { unmount } = render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.reject(new Error('clipboard unavailable after unmount'))
      await clipboardOperation.promise.catch(() => undefined)
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalled()
  })
})
