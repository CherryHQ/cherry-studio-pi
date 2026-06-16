import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiGatewaySettings from '../ApiGatewaySettings'

const setApiGatewayConfigMock = vi.hoisted(() => vi.fn())
const useApiGatewayMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => useApiGatewayMock()
}))

vi.mock('@renderer/utils/openExternal', () => ({
  openHttpExternalUrl: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: string; size?: string }) => (
    <button type="button" disabled={disabled || loading} {...props}>
      {children}
    </button>
  ),
  ButtonGroup: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  Divider: () => <hr />,
  IndicatorLight: () => <span />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement> & { title?: string }) => <>{children}</>
}))

describe('ApiGatewaySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setApiGatewayConfigMock.mockResolvedValue(undefined)
    useApiGatewayMock.mockReturnValue({
      apiGatewayConfig: {
        apiKey: 'cs-sk-test',
        host: '127.0.0.1',
        port: 12345
      },
      apiGatewayLoading: false,
      apiGatewayRunning: false,
      restartApiGateway: vi.fn(),
      setApiGatewayConfig: setApiGatewayConfigMock,
      startApiGateway: vi.fn(),
      stopApiGateway: vi.fn()
    })
    window.toast = {
      error: vi.fn(),
      success: vi.fn()
    } as unknown as typeof window.toast
  })

  it('lets users type an intermediate port value before saving on blur', async () => {
    render(<ApiGatewaySettings />)

    const portInput = screen.getByDisplayValue('12345')
    fireEvent.change(portInput, { target: { value: '8' } })

    expect(portInput).toHaveValue(8)
    expect(setApiGatewayConfigMock).not.toHaveBeenCalled()

    fireEvent.change(portInput, { target: { value: '8080' } })
    expect(setApiGatewayConfigMock).not.toHaveBeenCalled()

    fireEvent.blur(portInput)

    await waitFor(() => {
      expect(setApiGatewayConfigMock).toHaveBeenCalledWith({ port: 8080 })
    })
  })

  it('rejects invalid port values and restores the current config', () => {
    render(<ApiGatewaySettings />)

    const portInput = screen.getByDisplayValue('12345')
    fireEvent.change(portInput, { target: { value: '999' } })
    fireEvent.blur(portInput)

    expect(portInput).toHaveValue(12345)
    expect(setApiGatewayConfigMock).not.toHaveBeenCalled()
    expect(window.toast.error).toHaveBeenCalledWith('apiGateway.messages.invalidPort')
  })
})
