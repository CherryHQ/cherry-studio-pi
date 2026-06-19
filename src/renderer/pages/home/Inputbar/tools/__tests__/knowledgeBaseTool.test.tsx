import '@testing-library/jest-dom/vitest'

import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import knowledgeBaseTool from '../knowledgeBaseTool'

const updateAssistantMock = vi.fn()
const mockToastError = vi.fn()

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantMutations: () => ({
    updateAssistant: updateAssistantMock
  })
}))

vi.mock('../components/KnowledgeBaseButton', () => ({
  default: ({
    bases,
    disabled,
    onSelect
  }: {
    bases: KnowledgeBaseListItem[]
    disabled?: boolean
    onSelect: (bases: KnowledgeBaseListItem[]) => void
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect(bases)}>
      select knowledge bases
    </button>
  )
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBaseListItem> = {}): KnowledgeBaseListItem => ({
  id: 'kb-1',
  name: 'Docs',
  groupId: null,
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: 0.1,
  documentCount: 6,
  status: 'completed',
  error: null,
  searchMode: 'vector',
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  itemCount: 3,
  ...overrides
})

const knowledgeBase = createKnowledgeBase()

const renderTool = (
  overrides: {
    actions?: { setSelectedKnowledgeBases?: (bases: KnowledgeBaseListItem[]) => void }
    files?: unknown[]
  } = {}
) => {
  const ToolRender = knowledgeBaseTool.render as unknown as (props: Record<string, unknown>) => ReactNode

  return render(
    <ToolRender
      scope="chat"
      assistant={{ id: 'assistant-1' }}
      model={{ id: 'model-1', providerId: 'provider-1' }}
      state={{
        availableKnowledgeBases: [knowledgeBase],
        selectedKnowledgeBases: [],
        files: overrides.files ?? []
      }}
      actions={overrides.actions ?? { setSelectedKnowledgeBases: vi.fn() }}
      quickPanel={{
        registerRootMenu: vi.fn(),
        registerTrigger: vi.fn()
      }}
      quickPanelController={{}}
      t={(key: string) => key}
    />
  )
}

describe('knowledgeBaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateAssistantMock.mockResolvedValue(undefined)
    ;(global.window as any).toast = { error: mockToastError }
  })

  it('persists selected knowledge bases before updating local selection', async () => {
    const setSelectedKnowledgeBases = vi.fn()

    renderTool({ actions: { setSelectedKnowledgeBases } })
    fireEvent.click(screen.getByRole('button', { name: 'select knowledge bases' }))

    expect(updateAssistantMock).toHaveBeenCalledWith('assistant-1', { knowledgeBaseIds: ['kb-1'] })
    await waitFor(() => expect(setSelectedKnowledgeBases).toHaveBeenCalledWith([knowledgeBase]))
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('shows a save failure when knowledge base persistence fails', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('database unavailable'))

    renderTool()
    fireEvent.click(screen.getByRole('button', { name: 'select knowledge bases' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.save_failed: database unavailable'))
  })

  it('ignores stale save failures after unmount', async () => {
    const pendingSave = deferred<void>()
    updateAssistantMock.mockReturnValueOnce(pendingSave.promise)

    const { unmount } = renderTool()
    fireEvent.click(screen.getByRole('button', { name: 'select knowledge bases' }))
    unmount()

    await act(async () => {
      pendingSave.reject(new Error('failed after unmount'))
      await pendingSave.promise.catch(() => undefined)
    })

    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('disables selection when files are attached', () => {
    renderTool({ files: [{}] })

    expect(screen.getByRole('button', { name: 'select knowledge bases' })).toBeDisabled()
  })
})
