import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionMessages from '../AgentSessionMessages'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  chatVirtualListProps: null as null | { onReachTop?: () => void },
  closeAgentSessionWarm: vi.fn(),
  getGroupedMessages: vi.fn(() => ({})),
  prewarmAgentSession: vi.fn(),
  setTimeoutTimer: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      silly: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div data-testid="loading-icon" />
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  })
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  ChatContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useChatContextProvider: () => ({})
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageNavigation: 'none'
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/pages/home/Messages/Blocks', () => ({
  PartsProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/pages/home/Messages/ChatVirtualList', () => ({
  ChatVirtualList: (props: { onReachTop?: () => void }) => {
    mocks.chatVirtualListProps = props
    return <div data-testid="agent-chat-virtual-list" />
  }
}))

vi.mock('@renderer/pages/home/Messages/MessageAnchorLine', () => ({
  default: () => null
}))

vi.mock('@renderer/pages/home/Messages/MessageGroup', () => ({
  default: () => <div data-testid="message-group" />
}))

vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/pages/home/Messages/shared', () => ({
  MessagesContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SEND_MESSAGE: 'send-message'
  },
  EventEmitter: {
    on: vi.fn(() => vi.fn())
  }
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getGroupedMessages: mocks.getGroupedMessages
}))

describe('AgentSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chatVirtualListProps = null
    mocks.prewarmAgentSession.mockResolvedValue(undefined)
    mocks.closeAgentSessionWarm.mockResolvedValue(undefined)
    mocks.setTimeoutTimer.mockImplementation((_key: string, fn: () => void) => {
      fn()
      return vi.fn()
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          prewarmAgentSession: mocks.prewarmAgentSession,
          closeAgentSessionWarm: mocks.closeAgentSessionWarm
        }
      }
    })
  })

  it('keeps the older-message loader busy until async agent pagination settles', async () => {
    const pagination = deferred<void>()
    const loadOlder = vi.fn(() => pagination.promise)

    render(
      <AgentSessionMessages
        agentId="agent-1"
        sessionId="session-1"
        adaptedMessages={[]}
        partsMap={{}}
        isLoading={false}
        hasOlder
        loadOlder={loadOlder}
      />
    )

    act(() => {
      mocks.chatVirtualListProps?.onReachTop?.()
    })

    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalledWith(
      'agent-load-older-spinner',
      expect.any(Function),
      expect.any(Number)
    )

    await act(async () => {
      pagination.resolve()
      await pagination.promise
    })

    await waitFor(() =>
      expect(mocks.setTimeoutTimer).toHaveBeenCalledWith(
        'agent-load-older-spinner',
        expect.any(Function),
        expect.any(Number)
      )
    )
  })
})
