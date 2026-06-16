import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-content" {...props}>
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
  )
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/components/NutstorePathSelector', () => ({
  NutstorePathSelector: ({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (path: string) => void }) => (
    <div>
      <button type="button" onClick={() => onConfirm('/sync/cherry')}>
        confirm path
      </button>
      <button type="button" onClick={onCancel}>
        cancel path
      </button>
    </div>
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

async function showPopup() {
  const { default: NutstorePathPopup } = await import('../NutsorePathPopup')
  const settled = vi.fn()

  void NutstorePathPopup.show({} as Nutstore.Fs).then(settled)
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
  render(<>{rendered}</>)

  return { NutstorePathPopup, settled }
}

describe('NutstorePathPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('resolves null once when hidden repeatedly', async () => {
    const { NutstorePathPopup, settled } = await showPopup()

    await act(async () => {
      NutstorePathPopup.hide()
      NutstorePathPopup.hide()
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledWith(null)
    expect(mocks.TopView.hide).toHaveBeenCalledWith('NutstorePathPopup')
  })

  it('resolves selected path on confirm', async () => {
    const { settled } = await showPopup()

    fireEvent.click(screen.getByText('confirm path'))

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(settled).toHaveBeenCalledWith('/sync/cherry')
    expect(mocks.TopView.hide).toHaveBeenCalledWith('NutstorePathPopup')
  })
})
