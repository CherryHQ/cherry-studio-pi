import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentFormState } from '../descriptor'
import WorkspaceSection from '../sections/WorkspaceSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading,
    type = 'button',
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    type?: 'button' | 'submit' | 'reset'
  }) => {
    void loading
    return (
      <button type={type} {...props}>
        {children}
      </button>
    )
  },
  Field: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  FieldContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

function createForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    type: 'pi',
    name: 'Agent',
    description: '',
    model: '',
    workspacePath: '',
    planModel: '',
    smallModel: '',
    instructions: '',
    mcps: [],
    disabledTools: [],
    avatar: '',
    permissionMode: '',
    maxTurns: 0,
    envVarsText: '',
    soulEnabled: false,
    heartbeatEnabled: false,
    heartbeatInterval: 0,
    ...overrides
  }
}

describe('WorkspaceSection', () => {
  it('selects a first-session workspace during agent creation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const originalApi = window.api
    const selectFolder = vi.fn().mockResolvedValue('/Users/me/project')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...originalApi,
        file: {
          ...originalApi?.file,
          selectFolder
        }
      }
    })

    try {
      render(<WorkspaceSection form={createForm()} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'library.config.agent.field.workspace.select' }))

      expect(selectFolder).toHaveBeenCalledWith({
        title: 'library.config.agent.field.workspace.label',
        properties: ['openDirectory', 'createDirectory']
      })
      expect(onChange).toHaveBeenCalledWith({ workspacePath: '/Users/me/project' })
    } finally {
      Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
    }
  })

  it('shows the selected workspace path and exposes change and clear actions', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<WorkspaceSection form={createForm({ workspacePath: '/Users/me/project' })} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'library.config.agent.field.workspace.change' })).toBeInTheDocument()
    expect(screen.getByText('/Users/me/project')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'library.config.agent.field.workspace.clear' }))

    expect(onChange).toHaveBeenCalledWith({ workspacePath: '' })
  })
})
