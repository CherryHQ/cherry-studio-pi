import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentContent from '../AgentContent'

const { modelsMock, showSaveFailedMock, updateModelMock, updateSessionMock } = vi.hoisted(() => ({
  modelsMock: [] as Model[],
  showSaveFailedMock: vi.fn(),
  updateModelMock: vi.fn(),
  updateSessionMock: vi.fn()
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

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [true, vi.fn()]
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model }: { model?: Model }) => <span data-testid="model-avatar">{model?.id ?? 'none'}</span>
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({
    onSelect,
    trigger,
    value
  }: {
    onSelect?: (model: Model) => void
    trigger: ReactElement
    value?: Model
  }) => (
    <div data-testid="model-selector-value">
      {value?.id ?? 'none'}
      {trigger}
      <button type="button" onClick={() => onSelect?.(modelsMock[0])}>
        select mock model
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>
}))

vi.mock('@renderer/components/ResourceSelector', () => ({
  AgentSelector: ({ trigger }: { trigger: ReactElement }) => <div>{trigger}</div>
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useUpdateAgent: () => ({
    updateModel: updateModelMock
  })
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => () => true
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => ({
    session: { id: 'session-1', agentId: 'agent-1', workspace: null }
  }),
  useUpdateSession: () => ({
    updateSession: updateSessionMock
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({
    models: modelsMock
  })
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isTopNavbar: true })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: (providerId?: string) => (providerId ? `Provider ${providerId}` : '')
}))

vi.mock('@renderer/hooks/useSaveFailedToast', () => ({
  useSaveFailedToast: () => showSaveFailedMock
}))

vi.mock('../AgentLabel', () => ({
  AgentLabel: ({ agent }: { agent: AgentEntity }) => <span>{agent.name}</span>
}))

vi.mock('../AgentSidePanelDrawer', () => ({
  default: { show: vi.fn() }
}))

vi.mock('../OpenExternalAppButton', () => ({
  default: () => null
}))

vi.mock('../Tools', () => ({
  default: () => null
}))

vi.mock('../WorkspaceSelector', () => ({
  default: () => null
}))

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-1',
    type: 'pi',
    name: 'Agent',
    model: 'deepseek::deepseek-chat',
    modelName: null,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    orderKey: 'a0',
    ...overrides
  } as AgentEntity
}

describe('AgentContent', () => {
  beforeEach(() => {
    modelsMock.length = 0
    showSaveFailedMock.mockReset()
    updateModelMock.mockReset()
    updateSessionMock.mockReset()
  })

  it('resolves the active model by provider apiModelId for navbar selection state', () => {
    modelsMock.push({
      id: 'deepseek::deepseek-chat-internal',
      providerId: 'deepseek',
      provider: 'deepseek',
      apiModelId: 'deepseek-chat',
      name: 'DeepSeek Chat',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    render(<AgentContent activeAgent={createAgent()} />)

    expect(screen.getByTestId('model-selector-value')).toHaveTextContent('deepseek::deepseek-chat-internal')
    expect(screen.getByText(/DeepSeek Chat/)).toBeInTheDocument()
  })

  it('keeps showing the saved agent model while the model catalog is empty', () => {
    render(<AgentContent activeAgent={createAgent()} />)

    expect(screen.getByTestId('model-selector-value')).toHaveTextContent('deepseek::deepseek-chat')
    expect(screen.getByTestId('model-selector-value')).toHaveTextContent('deepseek-chat | Provider deepseek')
  })

  it('surfaces model update failures instead of leaving an unhandled rejection', async () => {
    const error = new Error('save failed')
    updateModelMock.mockRejectedValueOnce(error)
    modelsMock.push({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      provider: 'deepseek',
      apiModelId: 'deepseek-chat',
      name: 'DeepSeek Chat',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    render(<AgentContent activeAgent={createAgent()} />)

    fireEvent.click(screen.getByRole('button', { name: 'select mock model' }))

    await waitFor(() =>
      expect(updateModelMock).toHaveBeenCalledWith('agent-1', 'deepseek::deepseek-chat', {
        showSuccessToast: false
      })
    )
    expect(showSaveFailedMock).toHaveBeenCalledWith(error)
  })
})
