import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExportMenuSettings from '../ExportMenuSettings'

const mocks = vi.hoisted(() => ({
  setExportMenuOptions: vi.fn()
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

vi.mock('@cherrystudio/ui', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  )
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [
    {
      docx: false,
      image: false,
      joplin: false,
      markdown: false,
      markdown_reason: false,
      notion: false,
      obsidian: false,
      plain_text: false,
      siyuan: false,
      yuque: false
    },
    mocks.setExportMenuOptions
  ]
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

describe('ExportMenuSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setExportMenuOptions.mockResolvedValue(undefined)

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores stale export menu save errors after unmount', async () => {
    const saveOperation = deferred<void>()
    mocks.setExportMenuOptions.mockReturnValue(saveOperation.promise)

    const { unmount } = render(<ExportMenuSettings />)
    fireEvent.click(screen.getAllByRole('switch')[0])

    await waitFor(() => expect(mocks.setExportMenuOptions).toHaveBeenCalledWith({ image: true }))
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('write failed'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
