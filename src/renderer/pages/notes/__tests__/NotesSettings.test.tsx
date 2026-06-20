import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NotesSettings from '../NotesSettings'

const mocks = vi.hoisted(() => ({
  updateNotesPath: vi.fn(),
  updateSettings: vi.fn(),
  validateNotesDirectory: vi.fn(),
  getAppInfo: vi.fn(),
  selectFolder: vi.fn()
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    variant: _variant,
    ...props
  }: PropsWithChildren<ComponentProps<'button'> & { variant?: string }>) => {
    void _variant

    return (
      <button {...props} type={props.type ?? 'button'} disabled={disabled}>
        {children}
      </button>
    )
  },
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Slider: ({ className: _className }: { className?: string }) => {
    void _className
    return <div data-testid="slider" />
  },
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: ComponentProps<'button'> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" {...props} onClick={() => onCheckedChange?.(!checked)}>
      switch
    </button>
  )
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Selector', () => ({
  default: ({
    options,
    value,
    onChange
  }: {
    options: Array<{ label: string; value: string }>
    value: string
    onChange: (value: string) => void
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: {
      defaultViewMode: 'edit',
      defaultEditMode: 'preview',
      fontSize: 16,
      isFullWidth: true,
      showTableOfContents: true
    },
    updateSettings: mocks.updateSettings,
    notesPath: '/notes',
    updateNotesPath: mocks.updateNotesPath
  })
}))

vi.mock('@renderer/pages/settings', () => ({
  SettingContainer: ({ children }: PropsWithChildren<{ theme?: string; style?: React.CSSProperties }>) => (
    <div>{children}</div>
  ),
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: PropsWithChildren<{ theme?: string }>) => <section>{children}</section>,
  SettingHelpText: ({ children }: PropsWithChildren) => <p>{children}</p>,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('lucide-react', () => ({
  FolderOpen: () => <span />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('NotesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          selectFolder: mocks.selectFolder,
          validateNotesDirectory: mocks.validateNotesDirectory
        },
        getAppInfo: mocks.getAppInfo
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

  it('ignores apply-path results after unmount', async () => {
    const validationResult = deferred<boolean>()
    mocks.validateNotesDirectory.mockReturnValue(validationResult.promise)

    const { unmount } = render(<NotesSettings />)
    fireEvent.change(screen.getByPlaceholderText('notes.settings.data.work_directory_placeholder'), {
      target: { value: '/new-notes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'notes.settings.data.apply' }))

    await waitFor(() => expect(mocks.validateNotesDirectory).toHaveBeenCalledWith('/new-notes'))
    unmount()

    await act(async () => {
      validationResult.resolve(true)
      await validationResult.promise
    })

    expect(mocks.updateNotesPath).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('ignores reset-to-default results after unmount', async () => {
    const appInfoResult = deferred<{ notesPath: string }>()
    mocks.getAppInfo.mockReturnValue(appInfoResult.promise)

    const { unmount } = render(<NotesSettings />)
    fireEvent.click(screen.getAllByRole('button', { name: 'notes.settings.data.reset_to_default' })[0])

    await waitFor(() => expect(mocks.getAppInfo).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      appInfoResult.resolve({ notesPath: '/default-notes' })
      await appInfoResult.promise
    })

    expect(mocks.updateNotesPath).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
