import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HealthCheckDrawer from '../HealthCheckDrawer'

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', async () => {
  let handleRadioChange: (value: string) => void = () => undefined

  return {
    Alert: ({ message }: any) => <div>{message}</div>,
    Avatar: ({ children }: any) => <span>{children}</span>,
    AvatarFallback: ({ children }: any) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: any) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input: (props: any) => <input {...props} />,
    RadioGroup: ({ onValueChange, children }: any) => {
      handleRadioChange = onValueChange
      return <div>{children}</div>
    },
    RadioGroupItem: ({ value }: any) => (
      <button type="button" aria-label={`api-key-${value}`} onClick={() => handleRadioChange(value)}>
        {value}
      </button>
    ),
    SegmentedControl: ({ value, options, onValueChange }: any) => (
      <div>
        {options.map((option: { label: string; value: string }) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onValueChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    ),
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

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

describe('HealthCheckDrawer', () => {
  it('keeps single-key checks valid when the API key list shrinks', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined)
    const props = {
      open: true,
      title: 'check',
      apiKeys: ['sk-a', 'sk-b'],
      isChecking: false,
      modelStatuses: [],
      onClose: vi.fn(),
      onResetRun: vi.fn(),
      onStart
    }

    const { rerender } = render(<HealthCheckDrawer {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.single' }))
    fireEvent.click(screen.getByRole('button', { name: 'api-key-1' }))

    rerender(<HealthCheckDrawer {...props} apiKeys={['sk-a']} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        apiKeys: ['sk-a'],
        isConcurrent: true,
        timeout: 15000
      })
    )
  })

  it('ignores duplicate start clicks while a health check is still starting', async () => {
    const runningCheck = deferred<void>()
    const onStart = vi.fn().mockReturnValue(runningCheck.promise)

    render(
      <HealthCheckDrawer
        open
        title="check"
        apiKeys={['sk-a']}
        isChecking={false}
        modelStatuses={[]}
        onClose={vi.fn()}
        onResetRun={vi.fn()}
        onStart={onStart}
      />
    )

    const startButton = screen.getByRole('button', { name: 'settings.models.check.start' })
    fireEvent.click(startButton)
    fireEvent.click(startButton)

    expect(onStart).toHaveBeenCalledTimes(1)

    runningCheck.resolve()
    await waitFor(() => {
      expect(onStart).toHaveBeenCalledTimes(1)
    })
  })
})
