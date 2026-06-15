import type { InputbarCoreProps } from '@renderer/pages/home/Inputbar/components/InputbarCore'
import { allFilesExt } from '@shared/config/constant'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AgentSessionInputbar from '../AgentSessionInputbar'

const { inputbarSnapshots } = vi.hoisted(() => ({
  inputbarSnapshots: [] as Array<{
    supportedExts: string[]
    couldAddImageFile: boolean
  }>
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
  cacheService: {
    deleteCasual: vi.fn(),
    getCasual: vi.fn(),
    setCasual: vi.fn()
  }
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
      model: 'openai::gpt-4.1',
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
    models: [
      {
        id: 'openai::gpt-4.1',
        providerId: 'openai',
        name: 'GPT 4.1',
        capabilities: []
      }
    ]
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, fn: () => void) => fn()
  })
}))

vi.mock('@renderer/pages/home/Inputbar/InputbarTools', () => ({
  default: () => null
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
      return <div data-testid="agent-session-inputbar" />
    }
  }
})

describe('AgentSessionInputbar', () => {
  it('does not restrict attachments by the selected model capability', async () => {
    inputbarSnapshots.length = 0

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
})
