import type { InputbarCoreProps } from '@renderer/pages/home/Inputbar/components/InputbarCore'
import { allFilesExt } from '@shared/config/constant'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionInputbar from '../AgentSessionInputbar'

const { agentState, cacheServiceMock, inputbarSnapshots, inputbarToolModelIds, modelState, setTimeoutTimerMock } =
  vi.hoisted(() => ({
    agentState: {
      model: 'openai::gpt-4.1' as string | null
    },
    cacheServiceMock: {
      deleteCasual: vi.fn(),
      getCasual: vi.fn(),
      setCasual: vi.fn()
    },
    inputbarSnapshots: [] as Array<{
      supportedExts: string[]
      couldAddImageFile: boolean
    }>,
    inputbarToolModelIds: [] as string[],
    modelState: {
      models: [
        {
          id: 'openai::gpt-4.1',
          providerId: 'openai',
          name: 'GPT 4.1',
          capabilities: []
        }
      ] as Array<Record<string, unknown>>
    },
    setTimeoutTimerMock: vi.fn()
  }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@data/CacheService', () => ({
  cacheService: cacheServiceMock
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['Enter', vi.fn()]
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    Root: 'root',
    SlashCommands: 'slash-commands'
  },
  useQuickPanel: () => ({
    open: vi.fn()
  })
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: {
      id: 'agent-1',
      type: 'pi',
      name: 'Agent',
      model: agentState.model,
      instructions: '',
      configuration: {}
    }
  })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      workspace: null
    }
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({
    models: modelState.models
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: setTimeoutTimerMock
  })
}))

vi.mock('@renderer/pages/home/Inputbar/InputbarTools', () => ({
  default: ({ model }: { model: { id: string } }) => {
    inputbarToolModelIds.push(model.id)
    return null
  }
}))

vi.mock('@renderer/pages/home/Inputbar/components/InputbarCore', async () => {
  const { useInputbarToolsState } = await import('@renderer/pages/home/Inputbar/context/InputbarToolsProvider')

  return {
    InputbarCore: (props: InputbarCoreProps) => {
      const state = useInputbarToolsState()
      inputbarSnapshots.push({
        supportedExts: props.supportedExts,
        couldAddImageFile: state.couldAddImageFile
      })
      return (
        <>
          {props.leftToolbar}
          <button type="button" data-testid="agent-session-inputbar" onClick={props.handleSendMessage}>
            send
          </button>
        </>
      )
    }
  }
})

describe('AgentSessionInputbar', () => {
  beforeEach(() => {
    agentState.model = 'openai::gpt-4.1'
    inputbarSnapshots.length = 0
    inputbarToolModelIds.length = 0
    modelState.models = [
      {
        id: 'openai::gpt-4.1',
        providerId: 'openai',
        name: 'GPT 4.1',
        capabilities: []
      }
    ]
    cacheServiceMock.deleteCasual.mockReset()
    cacheServiceMock.getCasual.mockReset()
    cacheServiceMock.setCasual.mockReset()
    setTimeoutTimerMock.mockReset()
    setTimeoutTimerMock.mockImplementation((_key: string, fn: () => void) => fn())
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('does not restrict attachments by the selected model capability', async () => {
    render(
      <AgentSessionInputbar
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={vi.fn()}
        stop={vi.fn()}
        isStreaming={false}
      />
    )

    await waitFor(() => {
      expect(inputbarSnapshots.some((snapshot) => snapshot.couldAddImageFile)).toBe(true)
    })

    expect(inputbarSnapshots.at(-1)?.supportedExts).toEqual([allFilesExt])
  })

  it('does not schedule a delayed draft clear after sending', async () => {
    cacheServiceMock.getCasual.mockReturnValue('hello')
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    render(
      <AgentSessionInputbar
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={sendMessage}
        stop={vi.fn()}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByTestId('agent-session-inputbar'))

    await waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(setTimeoutTimerMock).not.toHaveBeenCalledWith('agentSession_sendMessage', expect.any(Function), 500)
  })

  it('allows sending when the agent stores a model id that is not in the local model list yet', async () => {
    cacheServiceMock.getCasual.mockReturnValue('hello')
    modelState.models = []
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    render(
      <AgentSessionInputbar
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={sendMessage}
        stop={vi.fn()}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByTestId('agent-session-inputbar'))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: 'hello' }, { body: expect.any(Object) }))
    expect(window.toast.error).not.toHaveBeenCalledWith('code.model_required')
  })

  it('keeps input tools mounted from the saved agent model while the model catalog is empty', async () => {
    modelState.models = []

    render(
      <AgentSessionInputbar
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={vi.fn()}
        stop={vi.fn()}
        isStreaming={false}
      />
    )

    await waitFor(() => {
      expect(inputbarToolModelIds).toContain('openai::gpt-4.1')
    })
  })
})
