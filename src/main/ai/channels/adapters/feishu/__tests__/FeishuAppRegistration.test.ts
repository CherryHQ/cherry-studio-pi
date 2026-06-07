import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registrationPoll } from '../FeishuAppRegistration'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

function jsonResponse(payload: unknown): Response {
  return {
    text: vi.fn(async () => JSON.stringify(payload))
  } as unknown as Response
}

describe('FeishuAppRegistration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('removes abort listeners after each successful polling delay', async () => {
    const controller = new AbortController()
    const addListenerSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

    vi.mocked(net.fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(
        jsonResponse({
          client_id: 'app-id',
          client_secret: 'app-secret',
          user_info: { open_id: 'open-id' }
        })
      )

    const promise = registrationPoll('feishu', 'device-code', {
      interval: 1,
      expiresIn: 30,
      signal: controller.signal
    })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      appId: 'app-id',
      appSecret: 'app-secret',
      openId: 'open-id'
    })
    expect(addListenerSpy).toHaveBeenCalledTimes(2)
    expect(removeListenerSpy).toHaveBeenCalledTimes(2)
    expect(net.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('aborts a pending delay without sending a poll request', async () => {
    const controller = new AbortController()
    const removeListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const promise = registrationPoll('feishu', 'device-code', {
      interval: 1,
      expiresIn: 30,
      signal: controller.signal
    })

    controller.abort()

    await expect(promise).rejects.toThrow('Registration polling aborted')
    expect(removeListenerSpy).toHaveBeenCalledTimes(1)
    expect(net.fetch).not.toHaveBeenCalled()
  })
})
