import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentDetail } from '../../../types'
import AgentConfigPage from '../AgentConfigPage'

const { createAgentMock, updateAgentMock, createWorkspaceByPathMock, createInitialSessionMock, cacheSetMock } =
  vi.hoisted(() => ({
    createAgentMock: vi.fn(),
    updateAgentMock: vi.fn(),
    createWorkspaceByPathMock: vi.fn(),
    createInitialSessionMock: vi.fn(),
    cacheSetMock: vi.fn()
  }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../../adapters/agentAdapter', () => ({
  useAgentMutations: () => ({
    createAgent: createAgentMock
  }),
  useAgentCreateCompanionMutations: () => ({
    createWorkspaceByPath: createWorkspaceByPathMock,
    createInitialSession: createInitialSessionMock
  }),
  useAgentMutationsById: () => ({
    updateAgent: updateAgentMock
  })
}))

vi.mock('@renderer/data/CacheService', () => ({
  cacheService: {
    set: cacheSetMock
  }
}))

vi.mock('@renderer/hooks/agents/useAgentTools', () => ({
  useAgentTools: () => ({
    tools: [
      {
        id: 'Read',
        name: 'Read',
        origin: 'builtin',
        approval: 'auto'
      }
    ],
    isLoading: false,
    error: undefined
  })
}))

vi.mock('../../ConfigEditorShell', () => ({
  ConfigEditorShell: ({
    children,
    onSave,
    onSectionChange,
    sections
  }: {
    children: ReactNode
    onSave: () => Promise<void>
    onSectionChange: (section: 'mode' | 'basic' | 'workspace' | 'prompt' | 'advanced' | 'tools' | 'permission') => void
    sections: Array<{ id: 'mode' | 'basic' | 'workspace' | 'prompt' | 'advanced' | 'tools' | 'permission' }>
  }) => (
    <div>
      {sections.map((section) => (
        <button key={section.id} type="button" onClick={() => onSectionChange(section.id)}>
          {section.id}
        </button>
      ))}
      <button type="button" onClick={() => void onSave()}>
        save
      </button>
      {children}
    </div>
  )
}))

vi.mock('../sections/AdvancedSection', () => ({
  default: ({ onChange }: { onChange: (patch: Partial<{ avatar: string; maxTurns: number }>) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ avatar: 'new-avatar' })}>
        set avatar
      </button>
      <button type="button" onClick={() => onChange({ maxTurns: 5 })}>
        set max turns
      </button>
    </div>
  )
}))

vi.mock('../sections/BasicSection', () => ({
  default: ({
    onChange
  }: {
    onChange: (patch: Partial<{ name: string; model: string; soulEnabled: boolean; workspacePath: string }>) => void
  }) => (
    <div>
      <button type="button" onClick={() => onChange({ name: 'Created Agent', model: 'anthropic::claude-sonnet-4-5' })}>
        set basic
      </button>
      <button type="button" onClick={() => onChange({ soulEnabled: true })}>
        enable autonomous
      </button>
    </div>
  )
}))

vi.mock('../sections/PermissionSection', () => ({
  default: () => null
}))

vi.mock('../sections/PromptSection', () => ({
  default: () => null
}))

vi.mock('../sections/ToolsSection', () => ({
  default: ({ onChange }: { onChange: (patch: Partial<{ disabledTools: string[]; mcps: string[] }>) => void }) => (
    <button type="button" onClick={() => onChange({ disabledTools: ['Read'], mcps: ['mcp-1'] })}>
      set tools
    </button>
  )
}))

vi.mock('../sections/WorkspaceSection', () => ({
  default: ({ onChange }: { onChange: (patch: Partial<{ workspacePath: string }>) => void }) => (
    <button type="button" onClick={() => onChange({ workspacePath: '/Users/me/project' })}>
      set workspace
    </button>
  )
}))

function createAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    model: 'anthropic::claude-sonnet-4-5',
    modelName: null,
    instructions: '',
    mcps: [],
    disabledTools: [],
    configuration: {
      avatar: 'old-avatar',
      plugin_state: 'keep-me'
    },
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    orderKey: 'k',
    ...overrides
  }
}

describe('AgentConfigPage', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
    updateAgentMock.mockReset()
    createWorkspaceByPathMock.mockReset()
    createInitialSessionMock.mockReset()
    cacheSetMock.mockReset()
    createInitialSessionMock.mockResolvedValue({
      id: 'session-created',
      agentId: 'created-1',
      name: 'common.unnamed',
      workspaceId: null,
      workspace: null,
      orderKey: 'a0',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z'
    })
  })

  it('uses the latest saved agent configuration as the next merge base', async () => {
    const user = userEvent.setup()
    const agent = createAgent()
    updateAgentMock
      .mockResolvedValueOnce(
        createAgent({
          configuration: {
            avatar: 'new-avatar',
            plugin_state: 'keep-me'
          }
        })
      )
      .mockResolvedValueOnce(
        createAgent({
          configuration: {
            avatar: 'new-avatar',
            plugin_state: 'keep-me',
            max_turns: 5
          }
        })
      )

    render(<AgentConfigPage agent={agent} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'advanced' }))
    await user.click(screen.getByRole('button', { name: 'set avatar' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))
    expect(updateAgentMock).toHaveBeenNthCalledWith(1, {
      configuration: {
        avatar: 'new-avatar',
        plugin_state: 'keep-me'
      }
    })

    await user.click(screen.getByRole('button', { name: 'set max turns' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock).toHaveBeenNthCalledWith(2, {
      configuration: {
        avatar: 'new-avatar',
        plugin_state: 'keep-me',
        max_turns: 5
      }
    })
  })

  it('creates an agent with the disabled tool and MCP bindings', async () => {
    const user = userEvent.setup()
    createAgentMock.mockResolvedValueOnce(createAgent({ id: 'created-1', name: 'Created Agent' }))

    render(<AgentConfigPage onBack={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'basic' }))
    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: 'tools' }))
    await user.click(screen.getByRole('button', { name: 'set tools' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createAgentMock).toHaveBeenCalledTimes(1))
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pi',
        name: 'Created Agent',
        model: 'anthropic::claude-sonnet-4-5',
        disabledTools: ['Read'],
        mcps: ['mcp-1']
      })
    )
    expect(createInitialSessionMock).toHaveBeenCalledWith({
      agentId: 'created-1',
      name: 'common.unnamed'
    })
    expect(cacheSetMock).toHaveBeenCalledWith('agent.active_session_id', 'session-created')
  })

  it('uses the selected workspace for the initial session during creation', async () => {
    const user = userEvent.setup()
    createWorkspaceByPathMock.mockResolvedValueOnce({ id: 'workspace-1', path: '/Users/me/project' })
    createAgentMock.mockResolvedValueOnce(createAgent({ id: 'created-workspace', name: 'Created Agent' }))
    createInitialSessionMock.mockResolvedValueOnce({
      id: 'session-workspace',
      agentId: 'created-workspace',
      name: 'common.unnamed',
      workspaceId: 'workspace-1',
      workspace: null,
      orderKey: 'a0',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z'
    })

    render(<AgentConfigPage onBack={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'basic' }))
    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: 'workspace' }))
    await user.click(screen.getByRole('button', { name: 'set workspace' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createWorkspaceByPathMock).toHaveBeenCalledWith('/Users/me/project'))
    expect(createInitialSessionMock).toHaveBeenCalledWith({
      agentId: 'created-workspace',
      name: 'common.unnamed',
      workspaceId: 'workspace-1'
    })
    expect(cacheSetMock).toHaveBeenCalledWith('agent.active_session_id', 'session-workspace')
  })

  it('does not create the agent when the selected workspace cannot be created', async () => {
    const user = userEvent.setup()
    createWorkspaceByPathMock.mockResolvedValueOnce(undefined)

    render(<AgentConfigPage onBack={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'basic' }))
    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: 'workspace' }))
    await user.click(screen.getByRole('button', { name: 'set workspace' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createWorkspaceByPathMock).toHaveBeenCalledWith('/Users/me/project'))
    expect(createAgentMock).not.toHaveBeenCalled()
    expect(createInitialSessionMock).not.toHaveBeenCalled()
  })

  it('creates enhanced-mode agents with the Claude SDK runtime when selected', async () => {
    const user = userEvent.setup()
    createAgentMock.mockResolvedValueOnce(createAgent({ id: 'created-2', name: 'Created Agent', type: 'claude-code' }))

    render(<AgentConfigPage onBack={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /enhanced\.title/ }))
    await user.click(screen.getByRole('button', { name: 'basic' }))
    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createAgentMock).toHaveBeenCalledTimes(1))
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'claude-code',
        name: 'Created Agent',
        model: 'anthropic::claude-sonnet-4-5'
      })
    )
  })

  it('guides new agents through the dialog wizard before creation', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    createAgentMock.mockResolvedValueOnce(createAgent({ id: 'created-dialog', name: 'Created Agent' }))

    render(<AgentConfigPage onBack={vi.fn()} onCreated={onCreated} presentation="dialog" />)

    expect(screen.getByRole('button', { name: /common\.next/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /common\.next/ }))
    expect(screen.getByRole('button', { name: 'set basic' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: /common\.next/ }))
    expect(screen.getByRole('button', { name: 'set workspace' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /common\.next/ }))
    await user.click(screen.getByRole('button', { name: /common\.next/ }))
    await user.click(screen.getByRole('button', { name: 'set tools' }))
    await user.click(screen.getByRole('button', { name: /library\.config\.agent\.create_title/ }))

    await waitFor(() => expect(createAgentMock).toHaveBeenCalledTimes(1))
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pi',
        name: 'Created Agent',
        model: 'anthropic::claude-sonnet-4-5',
        disabledTools: ['Read'],
        mcps: ['mcp-1']
      })
    )
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('hides the permission section when autonomous mode is enabled', async () => {
    const user = userEvent.setup()

    render(<AgentConfigPage agent={createAgent()} onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'permission' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'enable autonomous' }))

    expect(screen.queryByRole('button', { name: 'permission' })).not.toBeInTheDocument()
  })
})
