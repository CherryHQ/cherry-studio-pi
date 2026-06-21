import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UpdateDialogPopup from '../UpdateDialogPopup'

const mocks = vi.hoisted(() => ({
  hideTopView: vi.fn(),
  quitAndInstall: vi.fn(),
  updateAppUpdateState: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    ...props
  }: React.PropsWithChildren<{
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
    variant?: string
  }>) => {
    const { disabled, loading, onClick, variant } = props
    void loading
    void variant
    return (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    )
  },
  Dialog: ({
    children,
    open
  }: React.PropsWithChildren<{
    onOpenChange?: (open: boolean) => void
    open?: boolean
  }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <footer>{children}</footer>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h1>{children}</h1>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    hide: mocks.hideTopView,
    show: (node: React.ReactElement) => render(node)
  }
}))

vi.mock('@renderer/hooks/useAppUpdate', () => ({
  useAppUpdateState: () => ({
    updateAppUpdateState: mocks.updateAppUpdateState
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

describe('UpdateDialogPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        quitAndInstall: mocks.quitAndInstall
      }
    })
  })

  it('does not crash when install fails before toast is available', async () => {
    mocks.quitAndInstall.mockRejectedValue(new Error('install failed'))

    void UpdateDialogPopup.show({
      releaseInfo: {
        files: [],
        path: '',
        releaseDate: '2026-01-01T00:00:00.000Z',
        sha512: '',
        version: '1.2.3',
        releaseNotes: 'Changes'
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'update.install' }))

    await waitFor(() => {
      expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1)
    })
  })
})
