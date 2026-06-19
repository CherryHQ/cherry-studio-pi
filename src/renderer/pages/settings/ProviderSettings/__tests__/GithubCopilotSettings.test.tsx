import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GithubCopilotSettings from '../ProviderSpecific/GithubCopilotSettings'

const useProviderMock = vi.fn()
const useCopilotMock = vi.fn()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useCopilot', () => ({
  useCopilot: (...args: any[]) => useCopilotMock(...args)
}))

vi.mock('@renderer/utils/openExternal', () => ({
  openHttpExternalUrl: vi.fn(() => true)
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onClick,
    type
  }: {
    children?: ReactNode
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
  }) => (
    <button type={type ?? 'button'} onClick={onClick}>
      {children}
    </button>
  ),
  Input: (props: { value?: string; readOnly?: boolean; className?: string }) => <input {...props} />,
  Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (nextValue: number[]) => void }) => (
    <input
      aria-label="slider"
      value={value[0] ?? 0}
      onChange={(event) => onValueChange([Number(event.currentTarget.value)])}
    />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

describe('GithubCopilotSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useProviderMock.mockReturnValue({
      provider: {
        id: 'copilot',
        name: 'GitHub Copilot',
        apiKeys: [],
        settings: {
          isAuthed: false,
          rateLimit: 10
        }
      },
      updateProvider: vi.fn().mockResolvedValue(undefined),
      addApiKey: vi.fn().mockResolvedValue(undefined),
      deleteApiKey: vi.fn().mockResolvedValue(undefined)
    })

    useCopilotMock.mockReturnValue({
      username: '',
      avatar: '',
      defaultHeaders: {},
      updateState: vi.fn()
    })

    ;(window as any).api = {
      copilot: {
        getAuthMessage: vi.fn().mockResolvedValue({
          device_code: 'device-code',
          user_code: 'USER-CODE',
          verification_uri: 'https://github.com/login/device'
        }),
        getCopilotToken: vi.fn().mockResolvedValue({ access_token: 'access-token' }),
        saveCopilotToken: vi.fn().mockResolvedValue(undefined),
        getToken: vi.fn().mockResolvedValue({ token: 'ghu-token' }),
        getUser: vi.fn().mockResolvedValue({ login: 'octo', avatar: 'https://example.com/avatar.png' }),
        logout: vi.fn().mockResolvedValue(undefined)
      }
    }
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('ignores duplicate device-code requests while the first request is still pending', async () => {
    const authMessage = deferred<{
      device_code: string
      user_code: string
      verification_uri: string
    }>()
    window.api.copilot.getAuthMessage = vi.fn().mockReturnValue(authMessage.promise)

    render(<GithubCopilotSettings providerId="copilot" />)

    const startButton = screen.getByRole('button', { name: 'settings.provider.copilot.start_auth' })
    fireEvent.click(startButton)
    fireEvent.click(startButton)

    expect(window.api.copilot.getAuthMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      authMessage.resolve({
        device_code: 'device-code',
        user_code: 'USER-CODE',
        verification_uri: 'https://github.com/login/device'
      })
      await authMessage.promise
    })

    expect(screen.getByDisplayValue('USER-CODE')).toBeInTheDocument()
  })
})
