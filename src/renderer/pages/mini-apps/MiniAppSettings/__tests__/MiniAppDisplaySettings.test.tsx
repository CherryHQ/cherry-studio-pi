import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppDisplaySettings from '../MiniAppDisplaySettings'

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
  PageSidePanelItem: ({
    action,
    children,
    title
  }: React.PropsWithChildren<{ action?: React.ReactNode; title: string }>) => (
    <section>
      <h3>{title}</h3>
      {action}
      {children}
    </section>
  ),
  PageSidePanelSection: ({ children, title }: React.PropsWithChildren<{ title: string }>) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Slider: ({ onValueChange }: { onValueChange?: (value: number[]) => void }) => (
    <button type="button" onClick={() => onValueChange?.([5])}>
      slider
    </button>
  ),
  Switch: ({ onCheckedChange }: { onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="switch" onClick={() => onCheckedChange?.(true)} />
  ),
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key], mocks.setPreference]
}))

vi.mock('@renderer/components/Selector', () => ({
  default: ({ onChange }: { onChange?: (value: string) => void }) => (
    <button type="button" onClick={() => onChange?.('CN')}>
      region-selector
    </button>
  )
}))

vi.mock('lucide-react', () => ({
  Undo2: () => <span />
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

describe('MiniAppDisplaySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferences = {
      'feature.mini_app.max_keep_alive': 3,
      'feature.mini_app.open_link_external': false,
      'feature.mini_app.region': 'auto'
    }
    mocks.setPreference.mockResolvedValue(undefined)
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        info: vi.fn()
      }
    })
  })

  it('ignores stale preference save failures after unmount', async () => {
    const pendingSave = deferred<void>()
    mocks.setPreference.mockReturnValueOnce(pendingSave.promise)

    const { unmount } = render(<MiniAppDisplaySettings />)

    fireEvent.click(screen.getByRole('button', { name: 'region-selector' }))
    expect(mocks.setPreference).toHaveBeenCalledWith('CN')
    unmount()

    await act(async () => {
      pendingSave.reject(new Error('save failed after unmount'))
      await pendingSave.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
