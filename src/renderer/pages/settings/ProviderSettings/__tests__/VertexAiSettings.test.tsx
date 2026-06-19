import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VertexAiSettings from '../ProviderSpecific/VertexAiSettings'

const useProviderMock = vi.fn()
const useProviderAuthConfigMock = vi.fn()
const useProviderMutationsMock = vi.fn()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderAuthConfig: (...args: any[]) => useProviderAuthConfigMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

vi.mock('@renderer/utils/vertexAi', () => ({
  DEFAULT_VERTEX_AI_LOCATIONS: [{ value: 'us-central1', label: 'us-central1' }],
  parseVertexAIServiceAccountJson: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Input: (props: any) => <input {...props} />,
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Textarea: {
    Input: (props: any) => <textarea {...props} />
  }
}))

vi.mock('../primitives/ProviderSettingsPrimitives', () => ({
  ProviderHelpLink: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  ProviderHelpText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ProviderHelpTextRow: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ProviderSettingsSubtitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

describe('VertexAiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useProviderMock.mockReturnValue({
      provider: {
        id: 'vertexai',
        websites: {
          apiKey: 'https://cloud.google.com/vertex-ai'
        }
      }
    })

    useProviderAuthConfigMock.mockReturnValue({
      data: {
        type: 'iam-gcp',
        project: 'old-project',
        location: 'us-central1',
        credentials: {
          privateKey: 'old-private-key',
          clientEmail: 'old@example.com'
        }
      }
    })

    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
  })

  it('does not let an older failed save roll back a newer credential edit', async () => {
    const saves = [deferred<void>(), deferred<void>()]
    const updateAuthConfig = vi.fn().mockReturnValueOnce(saves[0].promise).mockReturnValueOnce(saves[1].promise)
    useProviderMutationsMock.mockReturnValue({ updateAuthConfig })

    render(<VertexAiSettings providerId="vertexai" />)

    fireEvent.change(
      screen.getByPlaceholderText('settings.provider.vertex_ai.service_account.client_email_placeholder'),
      {
        target: { value: 'new@example.com' }
      }
    )
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.vertex_ai.service_account.client_email_placeholder'))

    const privateKeyInput = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.private_key_placeholder'
    )
    fireEvent.change(privateKeyInput, {
      target: { value: 'new-private-key' }
    })
    fireEvent.blur(privateKeyInput)

    expect(updateAuthConfig).toHaveBeenCalledTimes(2)

    await act(async () => {
      saves[1].resolve()
      await saves[1].promise
    })

    await act(async () => {
      saves[0].reject(new Error('stale save failed'))
      await saves[0].promise.catch(() => undefined)
    })

    expect(
      screen.getByPlaceholderText('settings.provider.vertex_ai.service_account.private_key_placeholder')
    ).toHaveValue('new-private-key')
    expect(window.toast.error).not.toHaveBeenCalledWith('settings.provider.save_failed')
  })
})
