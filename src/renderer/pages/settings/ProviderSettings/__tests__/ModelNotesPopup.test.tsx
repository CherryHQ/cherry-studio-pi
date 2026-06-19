import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelNotesPopup from '../ModelNotesPopup'

const mocks = vi.hoisted(() => ({
  hide: vi.fn(),
  shownElement: null as any,
  show: vi.fn(),
  updateProvider: vi.fn(),
  useProvider: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, loading, onClick, type = 'button', ...props }: any) => (
    <button type={type} disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/MarkdownEditor', () => ({
  default: ({ onChange, placeholder, value }: any) => (
    <textarea
      aria-label="notes-editor"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={value}
    />
  )
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    hide: (...args: any[]) => mocks.hide(...args),
    show: (element: any, id: string) => {
      mocks.shownElement = element
      mocks.show(element, id)
    }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => mocks.useProvider(...args)
}))

vi.mock('../primitives/ProviderSettingsDrawer', () => ({
  default: ({ bodyClassName, children, footer, open, title }: any) =>
    open ? (
      <section className={bodyClassName}>
        <h1>{title}</h1>
        {children}
        {footer}
      </section>
    ) : null
}))

vi.mock('../primitives/ProviderSettingsPrimitives', () => ({
  drawerClasses: {
    footer: ''
  }
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

describe('ModelNotesPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shownElement = null
    mocks.updateProvider.mockResolvedValue(undefined)
    mocks.useProvider.mockReturnValue({
      provider: {
        id: 'openai',
        settings: {
          notes: 'old notes',
          temperature: 0.4
        }
      },
      updateProvider: mocks.updateProvider
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores a completed save after the popup unmounts', async () => {
    const runningSave = deferred<void>()
    mocks.updateProvider.mockReturnValueOnce(runningSave.promise)
    const resolveSpy = vi.fn()

    const popupPromise = ModelNotesPopup.show({ providerId: 'openai' })
    void popupPromise.then(resolveSpy)

    expect(mocks.show).toHaveBeenCalledWith(expect.anything(), 'ModelNotesPopup')

    const { unmount } = render(<>{mocks.shownElement}</>)

    fireEvent.change(screen.getByLabelText('notes-editor'), {
      target: { value: 'new notes' }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    })

    expect(mocks.updateProvider).toHaveBeenCalledWith({
      providerSettings: {
        notes: 'new notes',
        temperature: 0.4
      }
    })

    unmount()

    await act(async () => {
      runningSave.resolve(undefined)
      await runningSave.promise
    })

    expect(resolveSpy).not.toHaveBeenCalled()
    expect(mocks.hide).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
