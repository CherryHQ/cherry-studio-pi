import type { NormalToolResponse } from '@renderer/types'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessageMetaTool from '../meta/MessageMetaTool'

const highlightCodeMock = vi.hoisted(() => vi.fn())
const mockActions = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({ highlightCode: highlightCodeMock })
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockActions()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key) }),
  initReactI18next: { type: '3rdParty', init: vi.fn() }
}))

const createToolExecResponse = (code = 'console.log("ok")'): NormalToolResponse =>
  ({
    id: 'meta-call-1',
    tool: { name: 'tool_exec', type: 'builtin' },
    arguments: { code },
    status: 'pending',
    response: undefined,
    toolCallId: 'meta-call-1'
  }) as unknown as NormalToolResponse

describe('MessageMetaTool', () => {
  beforeEach(() => {
    highlightCodeMock.mockReset()
    mockActions.mockReturnValue({})
  })

  afterEach(() => vi.clearAllMocks())

  it('sanitizes highlighted tool_exec code before injecting it into the DOM', async () => {
    highlightCodeMock.mockResolvedValue('<span>safe</span><img src="x" onerror="window.__xss = true">')

    const { container } = render(<MessageMetaTool toolResponse={createToolExecResponse()} />)

    await waitFor(() => expect(screen.getByText('safe')).toBeInTheDocument())

    expect(container.innerHTML).toContain('safe')
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('falls back to plain code when highlighting fails', async () => {
    highlightCodeMock.mockRejectedValue(new Error('highlighter failed'))
    const code = 'throw new Error("boom")'

    render(<MessageMetaTool toolResponse={createToolExecResponse(code)} />)

    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledWith(code, 'javascript'))
    expect(screen.getByText(code)).toBeInTheDocument()
  })
})
