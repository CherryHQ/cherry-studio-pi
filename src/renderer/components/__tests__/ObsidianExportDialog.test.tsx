import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ObsidianProcessingMethod, PopupContainer } from '../ObsidianExportDialog'

const mocks = vi.hoisted(() => ({
  exportMarkdownToObsidian: vi.fn(),
  loggerError: vi.fn(),
  t: (key: string) => key
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: mocks.t
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['Vault']
}))

vi.mock('@renderer/utils/export', () => ({
  exportMarkdownToObsidian: mocks.exportMarkdownToObsidian,
  messagesToMarkdown: vi.fn(),
  messageToMarkdown: vi.fn(),
  messageToMarkdownWithReasoning: vi.fn(),
  topicToMarkdown: vi.fn()
}))

vi.mock('lucide-react', () => ({
  XIcon: () => <span data-testid="x-icon" />
}))

vi.mock('@cherrystudio/ui', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: ReactNode }) => <div data-testid={testId}>{children}</div>

  return {
    Alert: ({ message }: { message?: ReactNode }) => <div role="alert">{message}</div>,
    Button: ({ children, disabled, onClick, type = 'button', ...props }: any) => (
      <button type={type} disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
      open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: passthrough('dialog-content'),
    DialogFooter: passthrough('dialog-footer'),
    DialogHeader: passthrough('dialog-header'),
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    EmptyState: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
    Input: ({ onChange, value, ...props }: any) => <input value={value ?? ''} onChange={onChange} {...props} />,
    Label: ({ children }: { children?: ReactNode }) => <label>{children}</label>,
    Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectContent: passthrough('select-content'),
    SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectTrigger: passthrough('select-trigger'),
    SelectValue: ({ placeholder }: { placeholder?: ReactNode }) => <span>{placeholder}</span>,
    Spinner: ({ text }: { text?: ReactNode }) => <div>{text}</div>,
    Switch: ({ checked, onCheckedChange }: any) => (
      <input
        aria-label="switch"
        checked={checked}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        type="checkbox"
      />
    ),
    TreeSelect: () => <div data-testid="tree-select" />
  }
})

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function setupWindowMocks(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      obsidian: {
        getFiles: vi.fn().mockResolvedValue([]),
        getVaults: vi.fn().mockResolvedValue([{ name: 'Vault', path: '/vault' }])
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

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  })
}

describe('ObsidianExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports raw content while the dialog is still mounted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setupWindowMocks(writeText)
    const resolve = vi.fn()

    render(
      <PopupContainer
        open
        obsidianTags={null}
        processingMethod={ObsidianProcessingMethod.NEW_OR_OVERWRITE}
        rawContent="hello obsidian"
        resolve={resolve}
        title="Daily Note"
      />
    )

    const exportButton = await screen.findByRole('button', {
      name: 'chat.topics.export.obsidian_btn'
    })

    await act(async () => {
      fireEvent.click(exportButton)
    })

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('hello obsidian')))
    expect(mocks.exportMarkdownToObsidian).toHaveBeenCalledWith(expect.objectContaining({ vault: 'Vault' }))
    expect(resolve).toHaveBeenCalledWith(true)
  })

  it('ignores a stale export completion after unmount', async () => {
    const clipboardWrite = deferred<void>()
    const writeText = vi.fn().mockReturnValue(clipboardWrite.promise)
    setupWindowMocks(writeText)
    const resolve = vi.fn()

    const { unmount } = render(
      <PopupContainer
        open
        obsidianTags={null}
        processingMethod={ObsidianProcessingMethod.NEW_OR_OVERWRITE}
        rawContent="hello obsidian"
        resolve={resolve}
        title="Daily Note"
      />
    )

    const exportButton = await screen.findByRole('button', {
      name: 'chat.topics.export.obsidian_btn'
    })

    await act(async () => {
      fireEvent.click(exportButton)
    })
    expect(writeText).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      clipboardWrite.resolve()
      await clipboardWrite.promise
    })

    expect(mocks.exportMarkdownToObsidian).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('handles export preparation failures when toast is unavailable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    setupWindowMocks(writeText)
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    const resolve = vi.fn()

    render(
      <PopupContainer
        open
        obsidianTags={null}
        processingMethod={ObsidianProcessingMethod.NEW_OR_OVERWRITE}
        rawContent="hello obsidian"
        resolve={resolve}
        title="Daily Note"
      />
    )

    const exportButton = await screen.findByRole('button', {
      name: 'chat.topics.export.obsidian_btn'
    })

    await act(async () => {
      fireEvent.click(exportButton)
    })

    await waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to prepare Obsidian export:', expect.any(Error))
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
