import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderCustomHeaderDrawer from '../ProviderCustomHeaderDrawer'

const mocks = vi.hoisted(() => ({
  syncProviderModels: vi.fn(),
  updateDefaultHeaders: vi.fn(),
  updateProvider: vi.fn(),
  useProvider: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, loading, onClick, type = 'button', ...props }: any) => (
    <button type={type} disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  InputGroup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  InputGroupInput: (props: any) => <input {...props} />,
  MenuItem: ({ label, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  MenuList: ({ children }: any) => <div>{children}</div>,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useCopilot', () => ({
  useCopilot: () => ({
    defaultHeaders: {},
    updateDefaultHeaders: mocks.updateDefaultHeaders
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: unknown[]) => mocks.useProvider(...args)
}))

vi.mock('@renderer/utils', () => ({
  cn: (...items: unknown[]) => items.filter(Boolean).join(' '),
  validateApiHost: (value: string) => /^https?:\/\/[^\s]+$/.test(value)
}))

vi.mock('../../hooks/useProviderModelSync', () => ({
  useProviderModelSync: () => ({
    syncProviderModels: mocks.syncProviderModels
  })
}))

vi.mock('../../primitives/ProviderActions', () => ({
  default: ({ children, className }: any) => <div className={className}>{children}</div>
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open, title }: any) =>
    open ? (
      <section>
        <h1>{title}</h1>
        {children}
        {footer}
      </section>
    ) : null
}))

vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  customHeaderDrawerClasses: {
    addRowButton: '',
    bodyScroll: '',
    headerList: '',
    headerRow: '',
    headersJsonEditor: '',
    removeIconButton: ''
  },
  drawerClasses: {
    footer: ''
  },
  fieldClasses: {
    iconButton: '',
    input: '',
    inputGroup: ''
  }
}))

vi.mock('../../utils/providerSettingsSideEffects', () => ({
  applyProviderCustomHeaderSideEffects: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('ProviderCustomHeaderDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
    mocks.syncProviderModels.mockResolvedValue(undefined)
    mocks.updateProvider.mockResolvedValue(undefined)
    mocks.useProvider.mockReturnValue({
      provider: {
        id: 'openai',
        name: 'OpenAI',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' }
        },
        settings: {}
      },
      updateProvider: mocks.updateProvider
    })
  })

  it('ignores duplicate save clicks while request configuration is being persisted', async () => {
    const runningSave = deferred<void>()
    mocks.updateProvider.mockReturnValueOnce(runningSave.promise)

    render(<ProviderCustomHeaderDrawer providerId="openai" open onClose={vi.fn()} />)

    const saveButton = screen.getByRole('button', { name: 'common.save' })
    await act(async () => {
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)
    })

    expect(mocks.updateProvider).toHaveBeenCalledTimes(1)
    expect(saveButton).toBeDisabled()

    await act(async () => {
      runningSave.resolve()
    })
  })

  it('does not surface stale save failures after unmount', async () => {
    const runningSave = deferred<void>()
    mocks.updateProvider.mockReturnValueOnce(runningSave.promise)
    const { unmount } = render(<ProviderCustomHeaderDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(mocks.updateProvider).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      runningSave.reject(new Error('save failed after unmount'))
      await runningSave.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
