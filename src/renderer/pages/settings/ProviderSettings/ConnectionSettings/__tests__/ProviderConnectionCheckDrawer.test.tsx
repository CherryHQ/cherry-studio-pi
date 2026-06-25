import '@renderer/i18n'

import ProviderConnectionCheckDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  RadioGroup: ({ children }: any) => <div>{children}</div>,
  RadioGroupItem: ({ value }: any) => <span>{value}</span>,
  SelectDropdown: ({ items, selectedId, renderSelected }: any) => {
    const selected = items.find((item: { id: string }) => item.id === selectedId) ?? items[0]

    return <div>{selected && renderSelected ? renderSelected(selected) : selected?.label}</div>
  }
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

describe('ProviderConnectionCheckDrawer', () => {
  const baseProps = {
    open: true,
    models: [],
    apiKeys: [],
    isSubmitting: false,
    onClose: vi.fn(),
    onStart: vi.fn()
  }

  it('opens model health check from the footer and closes this drawer first', () => {
    const onClose = vi.fn()
    const onOpenModelHealthCheck = vi.fn()

    render(
      <ProviderConnectionCheckDrawer {...baseProps} onClose={onClose} onOpenModelHealthCheck={onOpenModelHealthCheck} />
    )

    const healthCheckButtonName = /Check all models|检测所有模型/

    fireEvent.click(screen.getByRole('button', { name: healthCheckButtonName }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenModelHealthCheck).toHaveBeenCalledTimes(1)
  })

  it('hides the model health check footer action when no handler is provided', () => {
    render(<ProviderConnectionCheckDrawer {...baseProps} />)

    expect(screen.queryByRole('button', { name: /Check all models|检测所有模型/ })).toBeNull()
  })

  it('does not leak the idle loading state to DOM buttons', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      render(<ProviderConnectionCheckDrawer {...baseProps} />)

      expect(consoleError.mock.calls.some((args) => args.some((arg) => String(arg).includes('loading')))).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('ignores duplicate start clicks while a connection check is still in flight', async () => {
    const runningCheck = deferred<void>()
    const onStart = vi.fn().mockReturnValue(runningCheck.promise)

    render(
      <ProviderConnectionCheckDrawer
        {...baseProps}
        models={[{ id: 'model-1', name: 'Model 1' }] as any}
        apiKeys={['sk-test']}
        onStart={onStart}
      />
    )

    const startButton = screen.getByRole('button', { name: /Start|开始|settings\.models\.check\.start/ })
    fireEvent.click(startButton)
    fireEvent.click(startButton)

    expect(onStart).toHaveBeenCalledTimes(1)

    runningCheck.resolve()
    await waitFor(() => {
      expect(onStart).toHaveBeenCalledTimes(1)
    })
  })
})
