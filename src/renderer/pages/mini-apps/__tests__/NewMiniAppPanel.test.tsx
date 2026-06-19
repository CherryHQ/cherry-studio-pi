import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NewMiniAppPanel from '../NewMiniAppPanel'

const mocks = vi.hoisted(() => ({
  miniApps: [],
  disabled: [],
  pinned: [],
  createCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  dialogOnOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    disabled: mocks.disabled,
    pinned: mocks.pinned,
    createCustomMiniApp: mocks.createCustomMiniApp
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading,
    onClick,
    disabled
  }: React.PropsWithChildren<{ loading?: boolean; onClick?: () => void; disabled?: boolean }>) => (
    <button type="button" onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Input: ({
    id,
    value,
    onChange,
    placeholder
  }: {
    id?: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
  Field: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Dialog: ({
    open,
    children,
    onOpenChange
  }: React.PropsWithChildren<{ open: boolean; onOpenChange?: (open: boolean) => void }>) => {
    mocks.dialogOnOpenChange = onOpenChange
    return open ? <>{children}</> : null
  },
  DialogContent: ({ children }: React.PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogClose: ({ children }: React.PropsWithChildren) => (
    <div onClick={() => mocks.dialogOnOpenChange?.(false)}>{children}</div>
  ),
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// window.toast — used in success/error paths
beforeEach(() => {
  mocks.dialogOnOpenChange = undefined
  mocks.createCustomMiniApp.mockClear()
  ;(window as unknown as { toast: { success: () => void; error: () => void; info: () => void } }).toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
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

describe('NewMiniAppPanel', () => {
  it('renders nothing when closed', () => {
    render(<NewMiniAppPanel open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('save button is disabled when required fields are empty', () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits with the trimmed form values', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.id_placeholder'), {
      target: { value: '  custom-app  ' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith({
        appId: 'custom-app',
        name: 'My App',
        url: 'https://my.app',
        logo: 'application',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      })
    })
  })

  it('ignores duplicate save clicks and blocks close while creating', async () => {
    const runningCreate = deferred<void>()
    const onClose = vi.fn()
    mocks.createCustomMiniApp.mockReturnValueOnce(runningCreate.promise)

    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.id_placeholder'), {
      target: { value: 'custom-app' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    const saveBtn = screen.getByRole('button', { name: /common\.save/ })
    fireEvent.click(saveBtn)
    fireEvent.click(saveBtn)

    expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)
    expect(saveBtn).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).not.toHaveBeenCalled()

    runningCreate.resolve()
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('ignores a completed create after unmount', async () => {
    const runningCreate = deferred<void>()
    const onClose = vi.fn()
    mocks.createCustomMiniApp.mockReturnValueOnce(runningCreate.promise)

    const { unmount } = render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.id_placeholder'), {
      target: { value: 'custom-app' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))
    expect(mocks.createCustomMiniApp).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      runningCreate.resolve()
      await runningCreate.promise
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
  })

  it('ignores a completed logo file read after the panel closes', async () => {
    const readers: Array<{
      onerror: (() => void) | null
      onload: ((event: { target?: { result?: string } }) => void) | null
      readAsDataURL: ReturnType<typeof vi.fn>
    }> = []

    class MockFileReader {
      onerror: (() => void) | null = null
      onload: ((event: { target?: { result?: string } }) => void) | null = null
      readAsDataURL = vi.fn()

      constructor() {
        readers.push(this)
      }
    }

    vi.stubGlobal('FileReader', MockFileReader)

    const onClose = vi.fn()
    const { rerender } = render(<NewMiniAppPanel open={true} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('settings.miniApps.custom.logo_upload_label'), {
      target: {
        files: [new File(['logo'], 'logo.png', { type: 'image/png' })]
      }
    })
    expect(readers).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    rerender(<NewMiniAppPanel open={false} onClose={onClose} />)

    await act(async () => {
      readers[0].onload?.({ target: { result: 'data:image/png;base64,logo' } })
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.toast.success).not.toHaveBeenCalled()
  })

  it('submits a logo URL when provided', async () => {
    render(<NewMiniAppPanel open={true} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.id_placeholder'), {
      target: { value: 'custom-app' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.name_placeholder'), {
      target: { value: 'My App' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.url_placeholder'), {
      target: { value: 'https://my.app' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.miniApps.custom.logo_url_placeholder'), {
      target: { value: 'https://my.app/logo.png' }
    })

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mocks.createCustomMiniApp).toHaveBeenCalledWith(
        expect.objectContaining({
          logo: 'https://my.app/logo.png'
        })
      )
    })
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<NewMiniAppPanel open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
