import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NUTSTORE_SSO_TIMEOUT_MS, useNutstoreSso } from '../useNutstoreSso'

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMocks
  }
}))

type ProtocolPayload = { url: string }

describe('useNutstoreSso', () => {
  const onReceiveDataMock = vi.fn()
  const removeListenerMock = vi.fn()
  let protocolListener: ((payload: ProtocolPayload) => void | Promise<void>) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    protocolListener = undefined

    onReceiveDataMock.mockImplementation((listener: (payload: ProtocolPayload) => void | Promise<void>) => {
      protocolListener = listener
      return removeListenerMock
    })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        protocol: {
          onReceiveData: onReceiveDataMock
        }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the encrypted token and cleans up the protocol listener', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const promise = result.current()

    expect(onReceiveDataMock).toHaveBeenCalledTimes(1)

    await protocolListener?.({ url: 'cherrystudiopi://providers?x=1' })
    vi.advanceTimersByTime(NUTSTORE_SSO_TIMEOUT_MS - 1)
    await protocolListener?.({ url: 'cherrystudiopi://nutstore?s=encrypted-token' })

    await expect(promise).resolves.toBe('encrypted-token')
    expect(removeListenerMock).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated protocol callbacks and rejects on timeout', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const promise = result.current()
    const rejection = expect(promise).rejects.toThrow('Nutstore SSO flow timed out')

    await protocolListener?.({ url: 'cherrystudiopi://providers?x=1' })
    vi.advanceTimersByTime(NUTSTORE_SSO_TIMEOUT_MS)

    await rejection
    expect(removeListenerMock).toHaveBeenCalledTimes(1)
    expect(loggerMocks.warn).toHaveBeenCalled()
  })

  it('rejects malformed callback urls and cleans up', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const promise = result.current()
    const rejection = expect(promise).rejects.toThrow()

    await protocolListener?.({ url: 'not a url' })

    await rejection
    expect(removeListenerMock).toHaveBeenCalledTimes(1)
    expect(loggerMocks.error).toHaveBeenCalled()
  })
})
