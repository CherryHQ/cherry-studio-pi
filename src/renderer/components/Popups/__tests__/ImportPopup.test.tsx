import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  importChatGPTConversations: vi.fn(),
  loggerError: vi.fn(),
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ description, message }: { description?: ReactNode; message?: ReactNode }) => (
    <div>
      <div>{message}</div>
      <div>{description}</div>
    </div>
  ),
  Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => {
    void loading
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onPointerDownOutside,
    ...props
  }: {
    children?: ReactNode
    onPointerDownOutside?: unknown
    [key: string]: unknown
  }) => {
    void onPointerDownOutside
    return (
      <div data-testid="dialog-content" {...props}>
        {children}
      </div>
    )
  },
  DialogFooter: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-footer" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-header" {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <h2 data-testid="dialog-title" {...props}>
      {children}
    </h2>
  ),
  Spinner: ({ text }: { text?: ReactNode }) => <div>{text}</div>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/services/import', () => ({
  importChatGPTConversations: mocks.importChatGPTConversations
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key)
  })
}))

async function showPopup() {
  const { default: ImportPopup } = await import('../ImportPopup')
  const settled = vi.fn()

  void ImportPopup.show().then(settled)
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
  render(<>{rendered}</>)

  return { ImportPopup, settled }
}

describe('ImportPopup', () => {
  let previousApi: unknown
  let previousToast: unknown

  beforeEach(() => {
    previousApi = window.api
    previousToast = window.toast
    vi.clearAllMocks()
    vi.useFakeTimers()
    window.api = {
      ...window.api,
      file: {
        ...window.api?.file,
        open: vi.fn()
      }
    } as typeof window.api
    window.toast = {
      ...window.toast,
      error: vi.fn(),
      success: vi.fn()
    } as typeof window.toast
  })

  afterEach(() => {
    window.api = previousApi as typeof window.api
    window.toast = previousToast as typeof window.toast
    vi.useRealTimers()
    vi.resetModules()
  })

  it('resolves success when ChatGPT import completes', async () => {
    const { settled } = await showPopup()
    vi.mocked(window.api.file.open).mockResolvedValue({ content: '{"ok":true}' })
    mocks.importChatGPTConversations.mockResolvedValue({
      success: true,
      topicsCount: 2,
      messagesCount: 5
    })

    await act(async () => {
      fireEvent.click(screen.getByText('import.chatgpt.button'))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledWith({ success: true })
    expect(window.toast.success).toHaveBeenCalled()
    expect(mocks.TopView.hide).toHaveBeenCalledWith('ImportPopup')
  })

  it('ignores duplicate import clicks while file selection is pending', async () => {
    await showPopup()
    let resolveOpen: (value: { content: string } | null) => void = () => {}
    vi.mocked(window.api.file.open).mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      })
    )

    await act(async () => {
      const importButton = screen.getByText('import.chatgpt.button')
      fireEvent.click(importButton)
      fireEvent.click(importButton)
      await Promise.resolve()
    })

    expect(window.api.file.open).toHaveBeenCalledOnce()

    await act(async () => {
      resolveOpen(null)
      await Promise.resolve()
    })
  })

  it('resolves empty result on cancel', async () => {
    const { settled } = await showPopup()

    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'))
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledWith({})
    expect(mocks.TopView.hide).toHaveBeenCalledWith('ImportPopup')
  })
})
