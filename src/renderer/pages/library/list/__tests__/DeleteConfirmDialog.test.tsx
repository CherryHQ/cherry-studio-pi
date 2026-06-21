import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '../../types'
import { DeleteConfirmDialog } from '../DeleteConfirmDialog'

const mocks = vi.hoisted(() => ({
  deleteAssistant: vi.fn(),
  deleteAgent: vi.fn(),
  deletePrompt: vi.fn(),
  uninstallSkill: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: ({
    confirmText,
    onConfirm
  }: {
    confirmText: string
    onConfirm: () => Promise<void>
    children?: ReactNode
  }) => (
    <button
      type="button"
      onClick={() => {
        void onConfirm().catch(() => {})
      }}>
      {confirmText}
    </button>
  )
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

vi.mock('../../adapters/assistantAdapter', () => ({
  useAssistantMutationsById: () => ({
    deleteAssistant: mocks.deleteAssistant
  })
}))

vi.mock('../../adapters/agentAdapter', () => ({
  useAgentMutationsById: () => ({
    deleteAgent: mocks.deleteAgent
  })
}))

vi.mock('../../adapters/promptAdapter', () => ({
  usePromptMutationsById: () => ({
    deletePrompt: mocks.deletePrompt
  })
}))

vi.mock('../../adapters/skillAdapter', () => ({
  useSkillMutationsById: () => ({
    uninstallSkill: mocks.uninstallSkill
  })
}))

const assistantResource = {
  id: 'assistant-1',
  type: 'assistant',
  name: 'Assistant',
  description: '',
  avatar: '💬',
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  raw: {
    id: 'assistant-1',
    name: 'Assistant'
  }
} as unknown as Extract<ResourceItem, { type: 'assistant' }>

describe('DeleteConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('preserves nested delete failure details', async () => {
    mocks.deleteAssistant.mockRejectedValueOnce({ error: { message: 'delete failed from IPC' } })

    render(<DeleteConfirmDialog resource={assistantResource} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(window.toast?.error).toHaveBeenCalledWith('delete failed from IPC')
    })
  })
})
