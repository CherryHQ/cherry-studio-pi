import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  preferences: new Map<string, unknown>(),
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  },
  translateText: vi.fn()
}))

type TextareaInputProps = {
  value?: string
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  onInput?: React.FormEventHandler<HTMLTextAreaElement>
  ref?: React.Ref<HTMLTextAreaElement>
}

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onEscapeKeyDown,
    onPointerDownOutside,
    showCloseButton,
    ...props
  }: {
    children?: ReactNode
    onEscapeKeyDown?: unknown
    onPointerDownOutside?: unknown
    showCloseButton?: unknown
    [key: string]: unknown
  }) => {
    void onEscapeKeyDown
    void onPointerDownOutside
    void showCloseButton
    return (
      <div data-testid="dialog-content" {...props}>
        {children}
      </div>
    )
  },
  DialogFooter: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-footer" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-header" {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <h2 data-testid="dialog-title" {...props}>
      {children}
    </h2>
  ),
  Textarea: {
    Input: ({ ref, ...props }: TextareaInputProps) => <textarea ref={ref} aria-label="edit-text" {...props} />
  }
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...items: unknown[]) => items.filter(Boolean).join(' ')
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences.get(key)]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/hooks/translate/useTranslateLanguages', () => ({
  useLanguages: () => ({
    languages: [{ langCode: 'en-us', label: 'English' }]
  })
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: mocks.translateText
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => `${prefix}: failed`
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

async function showPopup() {
  const { default: TextEditPopup } = await import('../TextEditPopup')
  const settled = vi.fn()

  void TextEditPopup.show({ text: 'hello' }).then(settled)
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode
  const renderResult = render(<>{rendered}</>)

  return { TextEditPopup, settled, ...renderResult }
}

describe('TextEditPopup', () => {
  let previousModal: unknown
  let previousToast: unknown

  beforeEach(() => {
    previousModal = window.modal
    previousToast = window.toast
    vi.clearAllMocks()
    mocks.preferences.clear()
    mocks.preferences.set('chat.input.translate.target_language', 'en-us')
    mocks.preferences.set('chat.input.translate.show_confirm', false)
    window.modal = {
      ...window.modal,
      confirm: vi.fn()
    } as typeof window.modal
    window.toast = {
      ...window.toast,
      error: vi.fn()
    } as typeof window.toast
  })

  afterEach(() => {
    window.modal = previousModal as typeof window.modal
    window.toast = previousToast as typeof window.toast
    vi.resetModules()
  })

  it('ignores translation failures after the popup unmounts', async () => {
    const translation = deferred<string>()
    mocks.translateText.mockReturnValue(translation.promise)
    const { unmount } = await showPopup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.translate_text' }))
      await Promise.resolve()
    })

    unmount()

    await act(async () => {
      translation.reject(new Error('stale translation failed'))
      await translation.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(mocks.loggerError).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not start translating after the confirmation resolves for an unmounted popup', async () => {
    mocks.preferences.set('chat.input.translate.show_confirm', true)
    const confirmation = deferred<boolean>()
    vi.mocked(window.modal.confirm).mockReturnValue(
      confirmation.promise as unknown as ReturnType<typeof window.modal.confirm>
    )
    const { unmount } = await showPopup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.translate_text' }))
      await Promise.resolve()
    })

    unmount()

    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
      await Promise.resolve()
    })

    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.loggerError).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
