import { RESOURCE_SELECTOR_FORCE_CLOSE_EVENT } from '@renderer/components/ResourceSelector/resourceSelectorEvents'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE_ORDER } from '../constants'
import LibraryPage from '../LibraryPage'

const {
  allResourcesMock,
  assistantCatalogMock,
  duplicateAssistantMock,
  navigateMock,
  refetchSpy,
  resourceLibraryOptionsMock,
  routeSearchMock,
  toastErrorMock
} = vi.hoisted(() => ({
  allResourcesMock: [] as any[],
  assistantCatalogMock: {
    tabs: [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }] as Array<{
      id: string
      label: string
      count: number
    }>,
    presets: [] as any[]
  },
  duplicateAssistantMock: vi.fn(),
  navigateMock: vi.fn(),
  refetchSpy: vi.fn(),
  resourceLibraryOptionsMock: [] as any[],
  routeSearchMock: vi.fn(() => ({})),
  toastErrorMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
    create: (Component: ComponentType<Record<string, unknown>>) => Component
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => routeSearchMock()
}))

vi.mock('../adapters/assistantAdapter', () => ({
  useAssistantMutations: () => ({
    createAssistant: vi.fn(),
    duplicateAssistant: duplicateAssistantMock
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({
    ensureTags: vi.fn()
  }),
  useTagList: () => ({
    tags: []
  })
}))

vi.mock('../list/useAssistantPresetCatalog', () => ({
  ASSISTANT_CATALOG_MY_TAB: '__mine__',
  toCreateAssistantDtoFromCatalogPreset: vi.fn(),
  useAssistantPresetCatalog: () => assistantCatalogMock
}))

vi.mock('../list/useResourceLibrary', () => ({
  useResourceLibrary: (options: unknown) => {
    resourceLibraryOptionsMock.push(options)
    return {
      resources: allResourcesMock,
      allResources: allResourcesMock,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      typeCounts: {
        assistant: allResourcesMock.filter((resource) => resource.type === 'assistant').length,
        agent: allResourcesMock.filter((resource) => resource.type === 'agent').length,
        skill: allResourcesMock.filter((resource) => resource.type === 'skill').length,
        prompt: allResourcesMock.filter((resource) => resource.type === 'prompt').length
      },
      refetch: refetchSpy
    }
  }
}))

vi.mock('../list/LibrarySidebar', () => ({
  LibrarySidebar: () => <div data-testid="library-sidebar" />
}))

vi.mock('../list/DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: () => null
}))

vi.mock('../list/ImportAssistantDialog', () => ({
  ImportAssistantDialog: () => null
}))

vi.mock('../list/ImportSkillDialog', () => ({
  ImportSkillDialog: () => null
}))

vi.mock('../list/ResourceGrid', () => ({
  ResourceGrid: ({
    activeResourceType,
    assistantCatalog,
    onDuplicate,
    onEdit,
    onDelete,
    onSearchChange,
    resources,
    search,
    onCreate,
    onImportAssistant
  }: {
    activeResourceType: 'assistant' | 'agent' | 'skill' | 'prompt'
    assistantCatalog?: {
      activeTab: string
      onTabChange: (tabId: string) => void
    }
    onDuplicate: (resource: any) => void
    onEdit: (resource: any) => void
    onDelete: (resource: any) => void
    onSearchChange: (value: string) => void
    onCreate: (type: 'assistant' | 'agent' | 'skill' | 'prompt') => void
    onImportAssistant: () => void
    resources: any[]
    search: string
  }) => (
    <div data-testid="resource-grid" data-resource-type={activeResourceType}>
      <div data-testid="assistant-catalog-active-tab">{assistantCatalog?.activeTab ?? ''}</div>
      <input aria-label="library search" value={search} onChange={(event) => onSearchChange(event.target.value)} />
      <button type="button" onClick={() => onCreate('assistant')}>
        create assistant
      </button>
      <button type="button" onClick={() => onCreate('agent')}>
        create agent
      </button>
      <button type="button" onClick={() => onCreate('prompt')}>
        create prompt
      </button>
      <button type="button" onClick={() => assistantCatalog?.onTabChange('custom')}>
        select custom tab
      </button>
      <button type="button" disabled={!resources[0]} onClick={() => onDuplicate(resources[0])}>
        duplicate first
      </button>
      <button type="button" disabled={!resources[0]} onClick={() => onEdit(resources[0])}>
        edit first
      </button>
      <button type="button" disabled={!resources[0]} onClick={() => onDelete(resources[0])}>
        delete first
      </button>
      <button type="button" onClick={onImportAssistant}>
        import assistant
      </button>
    </div>
  )
}))

vi.mock('../editor/assistant/AssistantConfigPage', () => ({
  default: ({
    assistant,
    onCreated
  }: {
    assistant?: { id: string }
    onCreated?: (created: { id: string }) => void
  }) => (
    <div data-testid={assistant ? 'assistant-edit-page' : 'assistant-create-page'}>
      <button type="button" onClick={() => onCreated?.({ id: 'assistant-created' })}>
        finish assistant create
      </button>
    </div>
  )
}))

vi.mock('../editor/agent/AgentConfigPage', () => ({
  default: ({
    agent,
    onBack,
    onCreated
  }: {
    agent?: { id: string }
    onBack?: () => void
    onCreated?: (created: { id: string }, result?: { initialSessionId: string | null }) => void
  }) => (
    <div data-testid={agent ? 'agent-edit-page' : 'agent-create-page'}>
      <button type="button" onClick={() => onBack?.()}>
        cancel agent create
      </button>
      <button
        type="button"
        onClick={() => onCreated?.({ id: 'agent-created' }, { initialSessionId: 'session-created' })}>
        finish agent create
      </button>
    </div>
  )
}))

vi.mock('../editor/prompt/PromptConfigPage', () => ({
  default: ({ prompt, onCreated }: { prompt?: { id: string }; onCreated?: (created: { id: string }) => void }) => (
    <div data-testid={prompt ? 'prompt-edit-page' : 'prompt-create-page'}>
      <button type="button" onClick={() => onCreated?.({ id: 'prompt-created' })}>
        finish prompt create
      </button>
    </div>
  )
}))

function StickyTransientOverlayProbe({ closeAfterEvents = 1 }: { closeAfterEvents?: number }) {
  const [open, setOpen] = useState(true)
  const closeEventCountRef = useRef(0)

  useEffect(() => {
    const close = () => {
      closeEventCountRef.current += 1
      if (closeEventCountRef.current >= closeAfterEvents) {
        setOpen(false)
      }
    }

    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, close)
    return () => window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, close)
  }, [closeAfterEvents])

  return open ? <div data-testid="sticky-transient-overlay">sticky selector</div> : null
}

describe('LibraryPage create flow', () => {
  beforeEach(() => {
    allResourcesMock.length = 0
    assistantCatalogMock.tabs = [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }]
    assistantCatalogMock.presets = []
    duplicateAssistantMock.mockReset()
    navigateMock.mockReset()
    refetchSpy.mockReset()
    resourceLibraryOptionsMock.length = 0
    routeSearchMock.mockReset()
    routeSearchMock.mockReturnValue({})
    toastErrorMock.mockReset()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: toastErrorMock
      }
    })
  })

  it('uses the first sidebar resource type as the initial grid filter', () => {
    render(<LibraryPage />)

    expect(screen.getByTestId('resource-grid')).toHaveAttribute('data-resource-type', RESOURCE_TYPE_ORDER[0])
  })

  it('returns to the list and refetches after assistant creation succeeds', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create assistant' }))
    expect(screen.getByTestId('assistant-create-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish assistant create' }))

    await waitFor(() => {
      expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('assistant-edit-page')).not.toBeInTheDocument()
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('opens the agent chat page after agent creation succeeds', async () => {
    const user = userEvent.setup()
    const closeResourceSelectors = vi.fn()
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)

    render(<LibraryPage />)

    try {
      await user.click(screen.getByRole('button', { name: 'create agent' }))
      expect(screen.getByTestId('agent-create-page')).toBeInTheDocument()
      expect(closeResourceSelectors).toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'finish agent create' }))

      await waitFor(() => {
        expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('agent-edit-page')).not.toBeInTheDocument()
      expect(refetchSpy).toHaveBeenCalledTimes(1)
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/agents',
        search: { sessionId: 'session-created' },
        replace: true
      })
      expect(closeResourceSelectors.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    }
  })

  it('keeps closing transient selectors after the agent create dialog mounts', async () => {
    const user = userEvent.setup()

    render(
      <>
        <StickyTransientOverlayProbe closeAfterEvents={2} />
        <LibraryPage />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'create agent' }))

    expect(screen.getByTestId('agent-create-page')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('sticky-transient-overlay')).not.toBeInTheDocument()
    })
  })

  it('closes transient resource selectors when cancelling agent creation', async () => {
    const user = userEvent.setup()
    const closeResourceSelectors = vi.fn()
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)

    render(<LibraryPage />)

    try {
      await user.click(screen.getByRole('button', { name: 'create agent' }))
      expect(screen.getByTestId('agent-create-page')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'cancel agent create' }))

      await waitFor(() => {
        expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
      })
      expect(closeResourceSelectors.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    }
  })

  it('closes transient resource selectors before opening secondary library surfaces', async () => {
    const user = userEvent.setup()
    const closeResourceSelectors = vi.fn()
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    allResourcesMock.push({
      id: 'assistant-for-actions',
      type: 'assistant',
      name: 'Assistant for actions',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-for-actions', name: 'Assistant for actions', tags: [] }
    })

    try {
      render(<LibraryPage />)

      await user.click(screen.getByRole('button', { name: 'import assistant' }))
      expect(closeResourceSelectors).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'delete first' }))
      expect(closeResourceSelectors).toHaveBeenCalledTimes(2)

      await user.click(screen.getByRole('button', { name: 'edit first' }))
      await waitFor(() => {
        expect(screen.getByTestId('assistant-edit-page')).toBeInTheDocument()
      })
      expect(closeResourceSelectors.mock.calls.length).toBeGreaterThanOrEqual(3)
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    }
  })

  it('returns to the list and refetches after prompt creation succeeds', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create prompt' }))
    expect(screen.getByTestId('prompt-create-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish prompt create' }))

    await waitFor(() => {
      expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('prompt-edit-page')).not.toBeInTheDocument()
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reports assistant duplicate failures without an unhandled rejection', async () => {
    const user = userEvent.setup()
    duplicateAssistantMock.mockRejectedValueOnce(new Error('duplicate failed'))
    allResourcesMock.push({
      id: 'assistant-to-duplicate',
      type: 'assistant',
      name: 'Assistant to duplicate',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-to-duplicate', name: 'Assistant to duplicate', tags: [] }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'duplicate first' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('duplicate failed')
    })
    expect(refetchSpy).not.toHaveBeenCalled()
  })

  it('resets a stale assistant catalog tab before keeping assistant filters disabled', async () => {
    const user = userEvent.setup()
    routeSearchMock.mockReturnValue({ resourceType: 'assistant' })
    assistantCatalogMock.tabs = [
      { id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 },
      { id: 'custom', label: 'Custom', count: 1 }
    ]

    const { rerender } = render(<LibraryPage />)

    await user.type(screen.getByLabelText('library search'), 'needle')
    expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('needle')

    await user.click(screen.getByRole('button', { name: 'select custom tab' }))
    await waitFor(() => {
      expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('')
    })

    assistantCatalogMock.tabs = [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }]
    rerender(<LibraryPage />)

    await waitFor(() => {
      expect(screen.getByTestId('assistant-catalog-active-tab')).toHaveTextContent('__mine__')
      expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('needle')
    })
  })

  it('opens the assistant create page from route search', () => {
    routeSearchMock.mockReturnValue({ resourceType: 'assistant', action: 'create' })

    render(<LibraryPage />)

    expect(screen.getByTestId('assistant-create-page')).toBeInTheDocument()
  })

  it('closes transient resource selectors when route search opens agent creation', () => {
    const closeResourceSelectors = vi.fn()
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    routeSearchMock.mockReturnValue({ resourceType: 'agent', action: 'create' })

    try {
      render(<LibraryPage />)

      expect(screen.getByTestId('agent-create-page')).toBeInTheDocument()
      expect(closeResourceSelectors).toHaveBeenCalled()
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeResourceSelectors)
    }
  })

  it('opens the prompt create page from route search', () => {
    routeSearchMock.mockReturnValue({ resourceType: 'prompt', action: 'create' })

    render(<LibraryPage />)

    expect(screen.getByTestId('prompt-create-page')).toBeInTheDocument()
  })

  it('opens the agent editor from route search after resources load', () => {
    allResourcesMock.push({
      id: 'agent-from-selector',
      type: 'agent',
      name: 'Selector Agent',
      description: '',
      avatar: '',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'agent-from-selector' }
    })
    routeSearchMock.mockReturnValue({ resourceType: 'agent', action: 'edit', id: 'agent-from-selector' })

    render(<LibraryPage />)

    expect(screen.getByTestId('agent-edit-page')).toBeInTheDocument()
  })

  it('opens the assistant editor from route search after resources load', () => {
    allResourcesMock.push({
      id: 'assistant-from-selector',
      type: 'assistant',
      name: 'Selector Assistant',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-from-selector' }
    })
    routeSearchMock.mockReturnValue({ resourceType: 'assistant', action: 'edit', id: 'assistant-from-selector' })

    render(<LibraryPage />)

    expect(screen.getByTestId('assistant-edit-page')).toBeInTheDocument()
  })

  it('opens the prompt editor from route search after resources load', () => {
    allResourcesMock.push({
      id: 'prompt-from-selector',
      type: 'prompt',
      name: 'Selector Prompt',
      description: '',
      avatar: 'Aa',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'prompt-from-selector' }
    })
    routeSearchMock.mockReturnValue({ resourceType: 'prompt', action: 'edit', id: 'prompt-from-selector' })

    render(<LibraryPage />)

    expect(screen.getByTestId('prompt-edit-page')).toBeInTheDocument()
  })
})
