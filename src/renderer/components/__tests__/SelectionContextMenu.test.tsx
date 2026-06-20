import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionContextMenu from '../SelectionContextMenu'

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  loggerError: vi.fn(),
  quoteToMainWindow: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  ContextMenu: ({ children, onOpenChange }: any) => (
    <div
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenChange?.(true)
      }}>
      {children}
    </div>
  ),
  ContextMenuContent: ({ children }: any) => <div>{children}</div>,
  ContextMenuItem: ({ children, disabled, onSelect }: any) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  ContextMenuTrigger: ({ children }: any) => <>{children}</>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockSelection(text = 'selected text') {
  const fragment = document.createDocumentFragment()
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: vi.fn(() => ({
      cloneContents: () => fragment
    })),
    toString: () => text
  }

  vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
}

async function openMenu() {
  fireEvent.contextMenu(screen.getByText('content'))
  await screen.findByRole('button', { name: 'common.copy' })
}

describe('SelectionContextMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mockSelection()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.clipboardWriteText
      }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        quoteToMainWindow: mocks.quoteToMainWindow
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess
      }
    })
  })

  it('copies the selected text and shows success while mounted', async () => {
    mocks.clipboardWriteText.mockResolvedValueOnce(undefined)

    render(
      <SelectionContextMenu>
        <span>content</span>
      </SelectionContextMenu>
    )
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('selected text')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('message.copied')
  })

  it('shows a copy failure while mounted', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('denied'))

    render(
      <SelectionContextMenu>
        <span>content</span>
      </SelectionContextMenu>
    )
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(mocks.toastError).toHaveBeenCalledWith('message.copy.failed: denied')
  })

  it('ignores stale copy success after unmount', async () => {
    const copy = deferred()
    mocks.clipboardWriteText.mockReturnValueOnce(copy.promise)
    const { unmount } = render(
      <SelectionContextMenu>
        <span>content</span>
      </SelectionContextMenu>
    )
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    unmount()

    await act(async () => {
      copy.resolve()
      await copy.promise
    })

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('ignores stale quote failures after unmount', async () => {
    const quote = deferred()
    mocks.quoteToMainWindow.mockReturnValueOnce(quote.promise)
    const { unmount } = render(
      <SelectionContextMenu>
        <span>content</span>
      </SelectionContextMenu>
    )
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'chat.message.quote' }))

    unmount()

    await act(async () => {
      quote.reject(new Error('closed'))
      await quote.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
