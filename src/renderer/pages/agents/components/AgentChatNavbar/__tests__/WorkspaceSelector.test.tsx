import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceSelector from '../WorkspaceSelector'

const { createWorkspaceByPathMock, updateSessionMock } = vi.hoisted(() => ({
  createWorkspaceByPathMock: vi.fn(),
  updateSessionMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading: _loading,
    type = 'button',
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    type?: 'button' | 'submit' | 'reset'
  }) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/agents/useWorkspace', () => ({
  useAgentWorkspaceMutations: () => ({
    createWorkspaceByPath: createWorkspaceByPathMock
  })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useUpdateSession: () => ({
    updateSession: updateSessionMock
  })
}))

function createSession() {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session',
    workspaceId: null,
    workspace: null,
    orderKey: 'a0',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z'
  }
}

describe('WorkspaceSelector', () => {
  beforeEach(() => {
    createWorkspaceByPathMock.mockReset()
    updateSessionMock.mockReset()
  })

  it('selects a folder, creates a workspace, and updates the active session', async () => {
    const user = userEvent.setup()
    const originalApi = window.api
    const originalToast = window.toast
    const selectFolder = vi.fn().mockResolvedValue('/Users/me/project')
    const success = vi.fn()
    const error = vi.fn()

    createWorkspaceByPathMock.mockResolvedValueOnce({ id: 'workspace-1', path: '/Users/me/project' })
    updateSessionMock.mockResolvedValueOnce({ ...createSession(), workspaceId: 'workspace-1' })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...(originalApi ?? {}),
        file: {
          ...(originalApi?.file ?? {}),
          selectFolder
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        ...(originalToast ?? {}),
        success,
        error
      }
    })

    try {
      render(<WorkspaceSelector session={createSession()} />)

      await user.click(screen.getByRole('button', { name: /agent\.session\.workspace\.change/ }))

      expect(selectFolder).toHaveBeenCalledWith({
        title: 'agent.session.workspace.change',
        properties: ['openDirectory', 'createDirectory']
      })
      await waitFor(() => expect(createWorkspaceByPathMock).toHaveBeenCalledWith('/Users/me/project'))
      expect(updateSessionMock).toHaveBeenCalledWith(
        {
          id: 'session-1',
          workspaceId: 'workspace-1'
        },
        { showSuccessToast: false }
      )
      expect(success).toHaveBeenCalledWith('agent.session.workspace.updated')
      expect(error).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
      Object.defineProperty(window, 'toast', { configurable: true, value: originalToast })
    }
  })

  it('does not show a success toast when the session update fails', async () => {
    const user = userEvent.setup()
    const originalApi = window.api
    const originalToast = window.toast
    const selectFolder = vi.fn().mockResolvedValue('/Users/me/project')
    const success = vi.fn()
    const error = vi.fn()

    createWorkspaceByPathMock.mockResolvedValueOnce({ id: 'workspace-1', path: '/Users/me/project' })
    updateSessionMock.mockResolvedValueOnce(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...(originalApi ?? {}),
        file: {
          ...(originalApi?.file ?? {}),
          selectFolder
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        ...(originalToast ?? {}),
        success,
        error
      }
    })

    try {
      render(<WorkspaceSelector session={createSession()} />)

      await user.click(screen.getByRole('button', { name: /agent\.session\.workspace\.change/ }))

      await waitFor(() => expect(updateSessionMock).toHaveBeenCalledTimes(1))
      expect(success).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
      Object.defineProperty(window, 'toast', { configurable: true, value: originalToast })
    }
  })
})
