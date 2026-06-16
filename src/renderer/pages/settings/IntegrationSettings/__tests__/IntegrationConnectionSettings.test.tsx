import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import JoplinSettings from '../JoplinSettings'
import NotionSettings from '../NotionSettings'
import SiyuanSettings from '../SiyuanSettings'
import YuqueSettings from '../YuqueSettings'

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  notionRetrieve: vi.fn(),
  setPreference: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick
  }: React.PropsWithChildren<{ disabled?: boolean; loading?: boolean; onClick?: () => void }>) => (
    <button type="button" disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  InfoTooltip: ({ onClick }: { onClick?: () => void }) => <button type="button" aria-label="help" onClick={onClick} />,
  Input: ({
    id,
    onBlur,
    onChange,
    placeholder,
    type,
    value
  }: {
    id?: string
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
    value?: string
  }) => <input id={id} onBlur={onBlur} onChange={onChange} placeholder={placeholder} type={type} value={value ?? ''} />,
  RowFlex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  )
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

vi.mock('@notionhq/client', () => ({
  Client: vi.fn(() => ({
    databases: {
      retrieve: mocks.notionRetrieve
    }
  }))
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('../..', () => ({
  SettingDivider: () => <div />,
  SettingGroup: ({ children }: React.PropsWithChildren) => <section>{children}</section>,
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

describe('integration connection settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferences = {}
    mocks.setPreference.mockResolvedValue(undefined)
    mocks.notionRetrieve.mockReset()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('prevents duplicate Joplin connection checks while a check is pending', async () => {
    const runningFetch = deferred<Response>()
    global.fetch = vi.fn().mockReturnValueOnce(runningFetch.promise)
    mocks.preferences = {
      'data.integration.joplin.token': 'token',
      'data.integration.joplin.url': 'http://127.0.0.1:41184/'
    }

    render(<JoplinSettings />)

    const checkButton = screen.getByRole('button', { name: 'settings.data.joplin.check.button' })
    fireEvent.click(checkButton)
    fireEvent.click(checkButton)

    expect(fetch).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(checkButton).toBeDisabled())

    runningFetch.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    } as unknown as Response)
    await waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('settings.data.joplin.check.success')
    })
  })

  it('prevents duplicate Siyuan connection checks while a check is pending', async () => {
    const runningFetch = deferred<Response>()
    global.fetch = vi.fn().mockReturnValueOnce(runningFetch.promise)
    mocks.preferences = {
      'data.integration.siyuan.api_url': 'http://127.0.0.1:6806',
      'data.integration.siyuan.token': 'token'
    }

    render(<SiyuanSettings />)

    const checkButton = screen.getByRole('button', { name: 'settings.data.siyuan.check.button' })
    fireEvent.click(checkButton)
    fireEvent.click(checkButton)

    expect(fetch).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(checkButton).toBeDisabled())

    runningFetch.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 0 })
    } as unknown as Response)
    await waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('settings.data.siyuan.check.success')
    })
  })

  it('prevents duplicate Notion connection checks while a check is pending', async () => {
    const runningCheck = deferred<unknown>()
    mocks.notionRetrieve.mockReturnValueOnce(runningCheck.promise)
    mocks.preferences = {
      'data.integration.notion.api_key': 'secret_token',
      'data.integration.notion.database_id': 'database_id'
    }

    render(<NotionSettings />)

    const checkButton = screen.getByRole('button', { name: 'settings.data.notion.check.button' })
    fireEvent.click(checkButton)
    fireEvent.click(checkButton)

    expect(mocks.notionRetrieve).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(checkButton).toBeDisabled())

    runningCheck.resolve({ id: 'database_id' })
    await waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('settings.data.notion.check.success')
    })
  })

  it('prevents duplicate Yuque connection checks while a check is pending', async () => {
    const runningFetch = deferred<Response>()
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(runningFetch.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: { id: 1 } })
      } as unknown as Response)
    mocks.preferences = {
      'data.integration.yuque.token': 'token',
      'data.integration.yuque.url': 'https://www.yuque.com/cherry/studio'
    }

    render(<YuqueSettings />)

    const checkButton = screen.getByRole('button', { name: 'settings.data.yuque.check.button' })
    fireEvent.click(checkButton)
    fireEvent.click(checkButton)

    expect(fetch).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(checkButton).toBeDisabled())

    runningFetch.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    } as unknown as Response)
    await waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('settings.data.yuque.check.success')
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
