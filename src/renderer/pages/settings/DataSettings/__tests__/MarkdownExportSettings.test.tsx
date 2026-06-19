import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownExportSettings from '../MarkdownExportSettings'

const mocks = vi.hoisted(() => ({
  preferenceValues: {} as Record<string, unknown>,
  preferenceSetters: {} as Record<string, ReturnType<typeof vi.fn>>,
  selectFolder: vi.fn()
}))

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function preferenceSetter(key: string) {
  const setter = mocks.preferenceSetters[key] ?? vi.fn().mockResolvedValue(undefined)
  mocks.preferenceSetters[key] = setter
  return setter
}

vi.mock('@ant-design/icons', () => ({
  DeleteOutlined: () => <span />,
  FolderOpenOutlined: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onClick,
    variant: _variant
  }: React.PropsWithChildren<{
    onClick?: () => void
    variant?: string
  }>) => {
    void _variant

    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    )
  },
  InputGroup: ({ children }: React.PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  InputGroupAddon: ({ children }: React.PropsWithChildren<{ align?: string }>) => <div>{children}</div>,
  InputGroupButton: ({
    children,
    onClick
  }: React.PropsWithChildren<{
    className?: string
    onClick?: () => void
    size?: string
  }>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  InputGroupInput: ({
    placeholder,
    value
  }: {
    placeholder?: string
    readOnly?: boolean
    type?: string
    value?: string
  }) => <input placeholder={placeholder} readOnly value={value ?? ''} />,
  RowFlex: ({ children }: React.PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  )
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferenceValues[key], preferenceSetter(key)]
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => `${prefix}: failed`
}))

vi.mock('../..', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: React.PropsWithChildren<{ theme?: string }>) => <section>{children}</section>,
  SettingHelpText: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  SettingRow: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
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

describe('MarkdownExportSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferenceValues = {
      'data.export.markdown.exclude_citations': false,
      'data.export.markdown.force_dollar_math': false,
      'data.export.markdown.path': '',
      'data.export.markdown.show_model_name': false,
      'data.export.markdown.show_model_provider': false,
      'data.export.markdown.standardize_citations': false,
      'data.export.markdown.use_topic_naming_for_message_title': false
    }
    mocks.preferenceSetters = {}

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          selectFolder: mocks.selectFolder
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores a selected export directory after unmount', async () => {
    const selectedDirectory = deferred<string | null>()
    mocks.selectFolder.mockReturnValue(selectedDirectory.promise)

    const { unmount } = render(<MarkdownExportSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.markdown_export.select' }))

    await waitFor(() => expect(mocks.selectFolder).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      selectedDirectory.resolve('/exports')
      await selectedDirectory.promise
    })

    expect(preferenceSetter('data.export.markdown.path')).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not show stale save errors after unmount', async () => {
    const saveOperation = deferred<void>()
    preferenceSetter('data.export.markdown.path').mockReturnValue(saveOperation.promise)
    mocks.selectFolder.mockResolvedValue('/exports')

    const { unmount } = render(<MarkdownExportSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.markdown_export.select' }))

    await waitFor(() => expect(preferenceSetter('data.export.markdown.path')).toHaveBeenCalledWith('/exports'))
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('disk full'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
