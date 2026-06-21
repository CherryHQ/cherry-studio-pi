import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BackupPopup from '../BackupPopup'

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  backupToLanTransfer: vi.fn(),
  hideTopView: vi.fn()
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
  CircularProgress: () => <div data-testid="progress" />,
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

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n/label', () => ({
  getBackupProgressLabelKey: (stage: string) => `backup.progress.${stage}`
}))

vi.mock('@renderer/services/BackupService', () => ({
  backup: mocks.backup,
  backupToLanTransfer: mocks.backupToLanTransfer
}))

vi.mock('../../TopView', () => ({
  TopView: {
    hide: mocks.hideTopView,
    show: (node: React.ReactElement) => render(node)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('BackupPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: vi.fn(() => vi.fn())
        }
      }
    })
  })

  it('does not crash when backup fails before toast is available', async () => {
    mocks.backup.mockRejectedValue(new Error('disk full'))

    void BackupPopup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => {
      expect(mocks.backup).toHaveBeenCalledWith(false)
    })
  })
})
