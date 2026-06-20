import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/DataApiService')

const { debugMock, errorMock, warnMock } = vi.hoisted(() => ({
  debugMock: vi.fn(),
  errorMock: vi.fn(),
  warnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: debugMock,
      error: errorMock,
      warn: warnMock
    })
  }
}))

import { DataApiService } from '@data/DataApiService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/apiErrors'

describe('DataApiService', () => {
  const requestMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dataApi: {
          request: requestMock,
          subscribe: vi.fn()
        }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the IPC timeout timer after a successful request', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      data: { ok: true }
    })

    const service = new DataApiService()
    const result = await service.get('/providers' as never)

    expect(result).toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects stalled IPC requests with the configured timeout', async () => {
    requestMock.mockReturnValueOnce(new Promise(() => {}))

    const service = new DataApiService()
    service.configureRetry({ maxRetries: 0 })
    const request = service.get('/providers' as never)
    const expectation = expect(request).rejects.toMatchObject({ code: ErrorCode.TIMEOUT })

    await vi.advanceTimersByTimeAsync(3_000)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries retryable GET failures', async () => {
    requestMock
      .mockResolvedValueOnce({
        status: 503,
        error: DataApiErrorFactory.create(ErrorCode.SERVICE_UNAVAILABLE, 'Service is warming up').toJSON()
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { ok: true }
      })

    const service = new DataApiService()
    service.configureRetry({ retryDelay: 1 })
    const request = service.get('/providers' as never)

    await vi.runAllTimersAsync()

    await expect(request).resolves.toEqual({ ok: true })
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({ method: 'GET', path: '/providers' })
    expect(requestMock.mock.calls[1]?.[0]).toMatchObject({ method: 'GET', path: '/providers' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not automatically retry retryable mutation failures', async () => {
    requestMock.mockResolvedValueOnce({
      status: 503,
      error: DataApiErrorFactory.create(ErrorCode.SERVICE_UNAVAILABLE, 'Service is warming up').toJSON()
    })

    const service = new DataApiService()

    await expect(
      service.post(
        '/providers' as never,
        {
          body: { providerId: 'openai', name: 'OpenAI', defaultChatEndpoint: 'openai-chat-completions' }
        } as never
      )
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE })

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({ method: 'POST', path: '/providers' })
  })

  it('does not write request bodies or headers to debug logs', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      data: { ok: true }
    })

    const service = new DataApiService()
    await service.post(
      '/providers/openai/api-keys' as never,
      {
        body: { key: 'sk-secret-value', label: 'Primary' },
        headers: { Authorization: 'Bearer secret-token' }
      } as never
    )

    const serializedLogs = debugMock.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(serializedLogs).toContain('"hasBody":true')
    expect(serializedLogs).toContain('"hasHeaders":true')
    expect(serializedLogs).not.toContain('sk-secret-value')
    expect(serializedLogs).not.toContain('secret-token')
    expect(serializedLogs).not.toContain('Authorization')
  })

  it('keeps subscription events isolated when a subscriber callback throws', () => {
    const unsubscribe = vi.fn()
    let subscriptionHandler: ((data: unknown, event: string) => void) | undefined
    vi.mocked(window.api.dataApi.subscribe).mockImplementation((_path, handler) => {
      subscriptionHandler = handler
      return unsubscribe
    })

    const service = new DataApiService()
    const callback = vi.fn(() => {
      throw new Error('subscriber failed')
    })
    const stop = service.subscribe({ path: '/providers' } as never, callback)

    expect(() => subscriptionHandler?.({ id: 'openai' }, 'updated')).not.toThrow()
    expect(callback).toHaveBeenCalledWith({ id: 'openai' }, 'updated')
    expect(warnMock).toHaveBeenCalledWith('Subscription callback failed: /providers', expect.any(Error))

    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
