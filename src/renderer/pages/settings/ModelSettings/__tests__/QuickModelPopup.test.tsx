import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicNamingSettings } from '../QuickModelPopup'

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  setPreference: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ColFlex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Dialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  Divider: () => <hr />,
  Flex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  RowFlex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Switch: ({ onCheckedChange }: { onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" onClick={() => onCheckedChange?.(true)} />
  ),
  Textarea: {
    Input: ({
      onChange,
      placeholder,
      value
    }: {
      onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
      placeholder?: string
      value?: string
    }) => <textarea onChange={onChange} placeholder={placeholder} value={value ?? ''} />
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key], mocks.setPreference]
}))

vi.mock('@renderer/components/Icons', () => ({
  ResetIcon: () => <span />
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    hide: vi.fn(),
    show: vi.fn()
  }
}))

vi.mock('lucide-react', () => ({
  CircleHelp: () => <span />
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

vi.mock('../..', () => ({
  SettingSubtitle: ({ children }: React.PropsWithChildren) => <h3>{children}</h3>
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

describe('TopicNamingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferences = {
      'topic.naming.enabled': false,
      'topic.naming_prompt': 'old prompt'
    }
    mocks.setPreference.mockResolvedValue(undefined)
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores stale topic naming prompt save failures after unmount', async () => {
    const pendingSave = deferred<void>()
    mocks.setPreference.mockReturnValueOnce(pendingSave.promise)

    const { unmount } = render(<TopicNamingSettings />)

    fireEvent.change(screen.getByPlaceholderText('prompts.title'), {
      target: { value: 'new prompt' }
    })
    expect(mocks.setPreference).toHaveBeenCalledWith('new prompt')
    unmount()

    await act(async () => {
      pendingSave.reject(new Error('save failed after unmount'))
      await pendingSave.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
