import type { AgentEntity } from '@shared/data/types/agent'
import type { CherryUIMessage } from '@shared/data/types/message'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentChatInner } from '../AgentChat'

const mocks = vi.hoisted(() => ({
  activeExecutions: [],
  inputbarProps: [] as Array<{ isStreaming: boolean }>,
  loadOlder: vi.fn(),
  messages: [] as CherryUIMessage[],
  pending: false,
  refresh: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  status: 'ready' as 'ready' | 'streaming' | 'submitted' | 'error',
  stop: vi.fn()
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: mocks.messages,
    isLoading: false,
    hasOlder: false,
    loadOlder: mocks.loadOlder,
    refresh: mocks.refresh
  })
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    sendMessage: mocks.sendMessage,
    regenerate: vi.fn(),
    stop: mocks.stop,
    error: undefined,
    status: mocks.status,
    setMessages: mocks.setMessages,
    activeExecutions: mocks.activeExecutions,
    chat: {}
  })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ overlay: {} })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isTopNavbar: false })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: mocks.pending })
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => null
}))

vi.mock('../../home/Messages/ChatNavigation', () => ({
  default: () => null
}))

vi.mock('../../home/Messages/NarrowLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('../../home/uiToMessage', () => ({
  uiToMessage: (message: CherryUIMessage) => message
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: () => null
}))

vi.mock('../components/AgentSessionInputbar', () => ({
  default: (props: { isStreaming: boolean }) => {
    mocks.inputbarProps.push({ isStreaming: props.isStreaming })
    return null
  }
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: () => null
}))

vi.mock('../components/Sessions', () => ({
  default: () => null
}))

function createMessage(id: string): CherryUIMessage {
  return {
    id,
    role: 'user',
    parts: []
  } as CherryUIMessage
}

const activeAgent = {
  id: 'agent-1',
  name: 'Agent',
  type: 'pi',
  model: 'openai::gpt-4.1',
  modelName: 'GPT 4.1',
  configuration: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: 'agent-1'
} satisfies AgentEntity

function renderAgentChatInner() {
  return render(
    <AgentChatInner
      agentId="agent-1"
      sessionId="session-1"
      activeAgent={activeAgent}
      showRightSessions={false}
      messageNavigation="none"
      messageStyle=""
      isMultiSelectMode={false}
    />
  )
}

describe('AgentChatInner', () => {
  beforeEach(() => {
    mocks.loadOlder.mockReset()
    mocks.inputbarProps = []
    mocks.refresh.mockReset()
    mocks.sendMessage.mockReset()
    mocks.setMessages.mockReset()
    mocks.stop.mockReset()
    mocks.messages = []
    mocks.pending = false
    mocks.status = 'ready'
  })

  it('syncs refreshed agent session history into the chat state while idle', async () => {
    const firstMessages = [createMessage('message-1')]
    mocks.messages = firstMessages

    const { rerender } = renderAgentChatInner()

    await waitFor(() => expect(mocks.setMessages).toHaveBeenCalledWith(firstMessages))
    mocks.setMessages.mockClear()

    const refreshedMessages = [...firstMessages, createMessage('message-2')]
    mocks.messages = refreshedMessages

    rerender(
      <AgentChatInner
        agentId="agent-1"
        sessionId="session-1"
        activeAgent={activeAgent}
        showRightSessions={false}
        messageNavigation="none"
        messageStyle=""
        isMultiSelectMode={false}
      />
    )

    await waitFor(() => expect(mocks.setMessages).toHaveBeenCalledWith(refreshedMessages))
  })

  it('does not overwrite chat state from refreshed history while a stream is active', () => {
    mocks.status = 'streaming'
    mocks.messages = [createMessage('message-1')]

    renderAgentChatInner()

    expect(mocks.setMessages).not.toHaveBeenCalled()
  })

  it('does not overwrite chat state while the agent topic stream is pending', () => {
    mocks.pending = true
    mocks.status = 'ready'
    mocks.messages = [createMessage('message-1')]

    renderAgentChatInner()

    expect(mocks.setMessages).not.toHaveBeenCalled()
  })

  it('keeps the inputbar in streaming mode while useChat has submitted but shared status has not caught up', () => {
    mocks.pending = false
    mocks.status = 'submitted'
    mocks.messages = [createMessage('message-1')]

    renderAgentChatInner()

    expect(mocks.setMessages).not.toHaveBeenCalled()
    expect(mocks.inputbarProps.at(-1)).toEqual({ isStreaming: true })
  })
})
