import ProviderApiKeyListDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderApiKeyListDrawer'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateApiKeysMock = vi.fn()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderApiKeys: () => ({
    data: { keys: [] }
  }),
  useProviderMutations: () => ({
    updateApiKeys: updateApiKeysMock
  })
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open }: any) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))

describe('ProviderApiKeyListDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateApiKeysMock.mockResolvedValue(undefined)
    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('saves new API key drafts as enabled by default', async () => {
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: ' sk-new ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateApiKeysMock).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'sk-new',
          isEnabled: true
        })
      ])
    })
  })

  it('ignores save failures after the drawer unmounts', async () => {
    const save = deferred<void>()
    updateApiKeysMock.mockReturnValueOnce(save.promise)
    const { unmount } = render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'sk-new' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      save.reject(new Error('save failed after unmount'))
      await save.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
