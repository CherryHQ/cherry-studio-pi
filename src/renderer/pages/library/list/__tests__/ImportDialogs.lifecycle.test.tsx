import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  ensureTags: vi.fn(),
  installFromDirectory: vi.fn(),
  installFromZip: vi.fn(),
  onImported: vi.fn(),
  onInstalled: vi.fn(),
  onOpenChange: vi.fn(),
  parseAssistantImportContent: vi.fn(),
  selectFile: vi.fn(),
  droppedFiles: [] as File[]
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ message }: { message?: ReactNode }) => <div>{message}</div>,
  Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => {
    void loading
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Dropzone: ({
    children,
    disabled,
    onDrop
  }: {
    children?: ReactNode
    disabled?: boolean
    onDrop?: (files: File[], rejections: unknown[], event: unknown) => void
  }) => (
    <button
      type="button"
      data-testid="dropzone"
      disabled={disabled}
      onClick={() => onDrop?.(mocks.droppedFiles, [], {})}>
      {children}
    </button>
  ),
  DropzoneEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Input: ({
    value,
    onChange,
    ...props
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
  }) => {
    void value
    void onChange
    return <input {...props} />
  },
  Tabs: ({ children }: { children?: ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <div>{children}</div>
  ),
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: ReactNode; value?: string }) => <button type="button">{children}</button>,
  Textarea: {
    Input: ({ value, onValueChange, ...props }: { value?: string; onValueChange?: (value: string) => void }) => {
      void value
      void onValueChange
      return <textarea {...props} />
    }
  }
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
      const { initial, animate, exit, ...rest } = props
      void initial
      void animate
      void exit
      return <div {...rest}>{children}</div>
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key)
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({
    ensureTags: mocks.ensureTags
  })
}))

vi.mock('../../adapters/assistantAdapter', () => ({
  useAssistantMutations: () => ({
    createAssistant: mocks.createAssistant
  })
}))

vi.mock('../../adapters/skillAdapter', () => ({
  useSkillMutations: () => ({
    installFromDirectory: mocks.installFromDirectory,
    installFromZip: mocks.installFromZip
  })
}))

vi.mock('../../editor/assistant/transfer', () => ({
  AssistantTransferError: class AssistantTransferError extends Error {
    code = 'invalid_format'
  },
  parseAssistantImportContent: mocks.parseAssistantImportContent
}))

describe('library import dialog lifecycle guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.droppedFiles = []
    mocks.ensureTags.mockResolvedValue([])
    mocks.installFromZip.mockResolvedValue({ name: 'Example Skill' })
    mocks.installFromDirectory.mockResolvedValue({ name: 'Example Skill' })
    mocks.parseAssistantImportContent.mockReturnValue([{ dto: { name: 'Example Assistant' }, tags: [] }])
    mocks.createAssistant.mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          getPathForFile: vi.fn((file: File) => file.name),
          isDirectory: vi.fn().mockResolvedValue(false),
          select: mocks.selectFile
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('does not install a picked skill after the dialog unmounts', async () => {
    const pickedFile = deferred<Array<{ path: string }>>()
    mocks.selectFile.mockReturnValueOnce(pickedFile.promise)
    const { ImportSkillDialog } = await import('../ImportSkillDialog')
    const { unmount } = render(
      <ImportSkillDialog open onInstalled={mocks.onInstalled} onOpenChange={mocks.onOpenChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: /settings\.skills\.installFromZip/ }))
    await waitFor(() => expect(mocks.selectFile).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      pickedFile.resolve([{ path: '/tmp/example.zip' }])
      await pickedFile.promise
      await Promise.resolve()
    })

    expect(mocks.installFromZip).not.toHaveBeenCalled()
    expect(mocks.onInstalled).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })

  it('does not create assistants after dropped file text resolves post-unmount', async () => {
    const fileText = deferred<string>()
    mocks.droppedFiles = [
      {
        name: 'assistant.json',
        size: 32,
        text: vi.fn(() => fileText.promise)
      } as unknown as File
    ]
    const { ImportAssistantDialog } = await import('../ImportAssistantDialog')
    const { unmount } = render(
      <ImportAssistantDialog open onImported={mocks.onImported} onOpenChange={mocks.onOpenChange} />
    )

    fireEvent.click(screen.getByTestId('dropzone'))
    await waitFor(() => expect(mocks.droppedFiles[0].text).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      fileText.resolve('{"assistants":[]}')
      await fileText.promise
      await Promise.resolve()
    })

    expect(mocks.parseAssistantImportContent).not.toHaveBeenCalled()
    expect(mocks.createAssistant).not.toHaveBeenCalled()
    expect(mocks.onImported).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}
