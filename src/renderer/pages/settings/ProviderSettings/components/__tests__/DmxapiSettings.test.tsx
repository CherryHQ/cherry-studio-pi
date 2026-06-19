import DmxapiSettings from '@renderer/pages/settings/ProviderSettings/ProviderSpecific/DmxapiSettings'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProviderMock = vi.fn()
const updateProviderMock = vi.fn()
const radioGroupPropsSpy = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@cherrystudio/ui', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  RadioGroup: (props: any) => {
    radioGroupPropsSpy(props)
    return (
      <div data-testid="dmx-platform-group" data-value={props.value}>
        {props.children}
      </div>
    )
  },
  RadioGroupItem: (props: any) => <input type="radio" {...props} />
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  Dmxapi: (props: any) => <svg data-testid="dmx-logo" {...props} />
}))

vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  ProviderSettingsSubtitle: ({ children }: any) => <h3>{children}</h3>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key
  })
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

function setupProvider() {
  useProviderMock.mockReturnValue({
    provider: {
      id: 'dmxapi',
      endpointConfigs: {
        openai: {
          baseUrl: 'https://www.dmxapi.cn/v1',
          modelsApiUrl: 'https://www.dmxapi.cn/v1/models'
        }
      }
    },
    updateProvider: updateProviderMock
  })
}

function latestRadioGroupProps() {
  const lastCall = radioGroupPropsSpy.mock.calls.at(-1)
  if (!lastCall) {
    throw new Error('RadioGroup was not rendered')
  }
  return lastCall[0]
}

describe('DmxapiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateProviderMock.mockResolvedValue(undefined)
    setupProvider()
    window.toast = { error: vi.fn() } as any
  })

  it('does not show stale platform save errors after unmount', async () => {
    const save = createDeferred<void>()
    updateProviderMock.mockReturnValueOnce(save.promise)
    const { unmount } = render(<DmxapiSettings providerId="dmxapi" />)

    act(() => {
      latestRadioGroupProps().onValueChange('www.DMXAPI.com')
    })
    unmount()

    await act(async () => {
      save.reject(new Error('closed'))
      await save.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not let an older failed platform save roll back the latest selection', async () => {
    const firstSave = createDeferred<void>()
    updateProviderMock.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(undefined)
    render(<DmxapiSettings providerId="dmxapi" />)

    act(() => {
      latestRadioGroupProps().onValueChange('www.DMXAPI.com')
    })
    await act(async () => {
      latestRadioGroupProps().onValueChange('ssvip.DMXAPI.com')
      await Promise.resolve()
    })

    await act(async () => {
      firstSave.reject(new Error('first save failed late'))
      await firstSave.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
    expect(screen.getByTestId('dmx-platform-group')).toHaveAttribute('data-value', 'ssvip.DMXAPI.com')
  })
})
