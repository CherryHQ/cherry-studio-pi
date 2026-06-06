import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/DataApiService')

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

import { DataApiService } from '@data/DataApiService'
import { ErrorCode } from '@shared/data/api/apiErrors'

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
})
