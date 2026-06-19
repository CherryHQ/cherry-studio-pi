import { act, render, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ObsidianSettings from '../ObsidianSettings'

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  setPreference: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
  RowFlex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => <span>{placeholder}</span>,
  Spinner: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key], mocks.setPreference]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('../..', () => ({
  SettingDivider: () => <div />,
  SettingGroup: ({ children }: React.PropsWithChildren) => <section>{children}</section>,
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

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function setupWindowMocks() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      obsidian: {
        getVaults: vi.fn().mockResolvedValue([{ name: 'Vault', path: '/vault' }])
      }
    }
  })

  Object.defineProperty(window, 'toast', {
    configurable: true,
    value: {
      error: vi.fn()
    }
  })
}

describe('ObsidianSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferences = {}
    setupWindowMocks()
  })

  it('shows a save failure while the settings panel is still mounted', async () => {
    mocks.setPreference.mockRejectedValue(new Error('save failed'))

    render(<ObsidianSettings />)

    await waitFor(() => expect(mocks.setPreference).toHaveBeenCalledWith('Vault'))
    await waitFor(() => expect(window.toast.error).toHaveBeenCalled())
  })

  it('ignores default vault save failures after unmount', async () => {
    const saveDefaultVault = deferred<void>()
    mocks.setPreference.mockReturnValue(saveDefaultVault.promise)

    const { unmount } = render(<ObsidianSettings />)

    await waitFor(() => expect(mocks.setPreference).toHaveBeenCalledWith('Vault'))
    unmount()

    await act(async () => {
      saveDefaultVault.reject(new Error('save failed'))
      await saveDefaultVault.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
