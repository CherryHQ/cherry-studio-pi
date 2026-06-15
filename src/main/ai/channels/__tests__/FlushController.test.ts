import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlushController } from '../FlushController'

describe('FlushController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports errors from deferred scheduled flushes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const flushError = new Error('flush failed')
    const onScheduledFlushError = vi.fn()
    const controller = new FlushController(async () => {
      throw flushError
    }, onScheduledFlushError)

    await controller.throttledUpdate(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(onScheduledFlushError).toHaveBeenCalledWith(flushError)
  })

  it('cancels pending scheduled flushes when completed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const doFlush = vi.fn().mockResolvedValue(undefined)
    const controller = new FlushController(doFlush)

    await controller.throttledUpdate(100)
    expect(vi.getTimerCount()).toBe(1)

    controller.complete()

    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(100)

    expect(doFlush).not.toHaveBeenCalled()
  })
})
