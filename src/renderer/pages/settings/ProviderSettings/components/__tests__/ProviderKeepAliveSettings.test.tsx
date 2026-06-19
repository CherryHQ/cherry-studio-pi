import GpuStackSettings from '@renderer/pages/settings/ProviderSettings/ProviderSpecific/GpuStackSettings'
import LmStudioSettings from '@renderer/pages/settings/ProviderSettings/ProviderSpecific/LmStudioSettings'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProviderMock = vi.fn()
const updateProviderMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  EditableNumber: ({ value, onChange, onBlur, suffix }: any) => (
    <input aria-label={suffix} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  )
}))

vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  ProviderHelpText: ({ children }: any) => <p>{children}</p>,
  ProviderHelpTextRow: ({ children }: any) => <div>{children}</div>,
  ProviderSettingsSubtitle: ({ children }: any) => <h3>{children}</h3>
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('provider keep-alive settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.toast = {
      error: vi.fn()
    } as any
    updateProviderMock.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({
      provider: {
        id: 'lmstudio',
        settings: {
          keepAliveTime: 5,
          custom: true
        }
      },
      updateProvider: updateProviderMock
    })
  })

  it('saves LM Studio keep-alive changes on blur', () => {
    render(<LmStudioSettings providerId="lmstudio" />)

    const input = screen.getByLabelText('lmstudio.keep_alive_time.placeholder')
    fireEvent.change(input, { target: { value: '12.8' } })
    fireEvent.blur(input)

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        keepAliveTime: 12,
        custom: true
      }
    })
  })

  it('saves GPUStack keep-alive changes on blur', () => {
    render(<GpuStackSettings providerId="gpustack" />)

    const input = screen.getByLabelText('gpustack.keep_alive_time.placeholder')
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.blur(input)

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        keepAliveTime: 15,
        custom: true
      }
    })
  })

  it.each([
    ['LM Studio', LmStudioSettings, 'lmstudio.keep_alive_time.placeholder'],
    ['GPUStack', GpuStackSettings, 'gpustack.keep_alive_time.placeholder']
  ])('does not show stale %s keep-alive save errors after unmount', async (_name, Component, label) => {
    const save = createDeferred<void>()
    updateProviderMock.mockReturnValueOnce(save.promise)
    const { unmount } = render(<Component providerId="provider" />)

    const input = screen.getByLabelText(label)
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.blur(input)
    unmount()

    await act(async () => {
      save.reject(new Error('closed'))
      await save.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
