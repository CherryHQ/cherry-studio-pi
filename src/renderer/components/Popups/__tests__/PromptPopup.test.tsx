import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

type TextareaInputProps = {
  value?: string
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  ref?: React.Ref<HTMLTextAreaElement>
}

vi.mock('@cherrystudio/ui', () => {
  return {
    Box: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="box" {...props}>
        {children}
      </div>
    ),
    Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) =>
      open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="dialog-content" {...props}>
        {children}
      </div>
    ),
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
    Textarea: {
      Input: ({ ref, ...props }: TextareaInputProps) => <textarea ref={ref} aria-label="prompt" {...props} />
    }
  }
})

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
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

describe('PromptPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('resolves null only once when hidden repeatedly', async () => {
    vi.useFakeTimers()
    const { default: PromptPopup } = await import('../PromptPopup')
    const settled = vi.fn()

    void PromptPopup.show({ title: 'Rename', message: 'Name' }).then(settled)
    const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
    render(<>{rendered}</>)

    await act(async () => {
      PromptPopup.hide()
      PromptPopup.hide()
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledWith(null)
    expect(mocks.TopView.hide).toHaveBeenCalledTimes(1)
    expect(mocks.TopView.hide).toHaveBeenCalledWith('PromptPopup')
  })

  it('resolves the edited value on confirm', async () => {
    vi.useFakeTimers()
    const { default: PromptPopup } = await import('../PromptPopup')
    const settled = vi.fn()

    void PromptPopup.show({ title: 'Rename', message: 'Name', defaultValue: 'old' }).then(settled)
    const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
    render(<>{rendered}</>)

    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'new' } })
    fireEvent.click(screen.getByText('common.confirm'))

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledWith('new')
  })
})
