import { cacheService } from '@data/CacheService'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseMultiplePreferences } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useApiGateway } from '../useApiGateway'

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

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const mockToast = {
  success: vi.fn(),
  error: vi.fn()
}

const mockApiGateway = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn()
}

const setWindowApi = () => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ...window.api,
      apiGateway: mockApiGateway
    }
  })

  Object.defineProperty(window, 'toast', {
    configurable: true,
    value: mockToast
  })
}

describe('useApiGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockCacheUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.running', false)
    setWindowApi()
  })

  it('clears initial loading if shared cache becomes ready before the effect subscribes', async () => {
    vi.mocked(cacheService.isSharedCacheReady).mockReturnValueOnce(false).mockReturnValue(true)

    const { result } = renderHook(() => useApiGateway())

    await waitFor(() => {
      expect(result.current.apiGatewayLoading).toBe(false)
    })
    expect(cacheService.onSharedCacheReady).not.toHaveBeenCalled()
  })

  it.each([
    {
      actionName: 'startApiGateway',
      commandName: 'start',
      initialEnabled: false,
      persistedEnabled: true,
      successMessage: 'apiGateway.messages.startSuccess'
    },
    {
      actionName: 'stopApiGateway',
      commandName: 'stop',
      initialEnabled: true,
      persistedEnabled: false,
      successMessage: 'apiGateway.messages.stopSuccess'
    },
    {
      actionName: 'restartApiGateway',
      commandName: 'restart',
      initialEnabled: true,
      persistedEnabled: true,
      successMessage: 'apiGateway.messages.restartSuccess'
    }
  ] as const)(
    'waits for enabled preference persistence before showing $commandName success',
    async ({ actionName, commandName, initialEnabled, persistedEnabled, successMessage }) => {
      const preferenceSave = createDeferred<void>()
      const setApiGatewayConfig = vi.fn().mockReturnValue(preferenceSave.promise)

      mockUseMultiplePreferences.mockImplementation(() => [
        {
          apiKey: 'test-key',
          enabled: initialEnabled,
          host: '127.0.0.1',
          port: 23333
        },
        setApiGatewayConfig
      ])
      mockApiGateway[commandName].mockResolvedValue({ success: true })

      const { result } = renderHook(() => useApiGateway())
      let operationPromise!: Promise<void>

      act(() => {
        operationPromise = result.current[actionName]()
      })

      await waitFor(() => {
        expect(setApiGatewayConfig).toHaveBeenCalledWith({ enabled: persistedEnabled })
      })
      expect(mockToast.success).not.toHaveBeenCalled()

      await act(async () => {
        preferenceSave.resolve()
        await operationPromise
      })

      expect(mockToast.success).toHaveBeenCalledWith(successMessage)
    }
  )

  it('reports start failure instead of success when enabled preference persistence fails after IPC success', async () => {
    const setApiGatewayConfig = vi.fn().mockRejectedValue(new Error('persist failed'))

    mockUseMultiplePreferences.mockImplementation(() => [
      {
        apiKey: 'test-key',
        enabled: false,
        host: '127.0.0.1',
        port: 23333
      },
      setApiGatewayConfig
    ])
    mockApiGateway.start.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useApiGateway())

    await act(async () => {
      await result.current.startApiGateway()
    })

    expect(mockToast.success).not.toHaveBeenCalled()
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('apiGateway.messages.startError'))
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('persist failed'))
  })

  it('ignores concurrent gateway commands while an operation is in flight', async () => {
    const startOperation = createDeferred<{ success: true }>()
    const setApiGatewayConfig = vi.fn().mockResolvedValue(undefined)

    mockUseMultiplePreferences.mockImplementation(() => [
      {
        apiKey: 'test-key',
        enabled: false,
        host: '127.0.0.1',
        port: 23333
      },
      setApiGatewayConfig
    ])
    mockApiGateway.start.mockReturnValue(startOperation.promise)

    const { result } = renderHook(() => useApiGateway())
    let firstOperation!: Promise<void>
    let secondOperation!: Promise<void>

    act(() => {
      firstOperation = result.current.startApiGateway()
      secondOperation = result.current.startApiGateway()
    })

    expect(mockApiGateway.start).toHaveBeenCalledTimes(1)

    await act(async () => {
      startOperation.resolve({ success: true })
      await firstOperation
      await secondOperation
    })

    expect(setApiGatewayConfig).toHaveBeenCalledTimes(1)
  })

  it('persists successful starts but skips stale success toasts after unmount', async () => {
    const startOperation = createDeferred<{ success: true }>()
    const setApiGatewayConfig = vi.fn().mockResolvedValue(undefined)

    mockUseMultiplePreferences.mockImplementation(() => [
      {
        apiKey: 'test-key',
        enabled: false,
        host: '127.0.0.1',
        port: 23333
      },
      setApiGatewayConfig
    ])
    mockApiGateway.start.mockReturnValue(startOperation.promise)

    const { result, unmount } = renderHook(() => useApiGateway())
    let operationPromise!: Promise<void>

    act(() => {
      operationPromise = result.current.startApiGateway()
    })

    unmount()

    await act(async () => {
      startOperation.resolve({ success: true })
      await operationPromise
    })

    expect(setApiGatewayConfig).toHaveBeenCalledWith({ enabled: true })
    expect(mockToast.success).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('skips stale command errors after unmount', async () => {
    const startOperation = createDeferred<{ success: true }>()

    mockUseMultiplePreferences.mockImplementation(() => [
      {
        apiKey: 'test-key',
        enabled: false,
        host: '127.0.0.1',
        port: 23333
      },
      vi.fn().mockResolvedValue(undefined)
    ])
    mockApiGateway.start.mockReturnValue(startOperation.promise)

    const { result, unmount } = renderHook(() => useApiGateway())
    let operationPromise!: Promise<void>

    act(() => {
      operationPromise = result.current.startApiGateway()
    })

    unmount()

    await act(async () => {
      startOperation.reject(new Error('ipc closed'))
      await operationPromise
    })

    expect(mockToast.error).not.toHaveBeenCalled()
  })
})
