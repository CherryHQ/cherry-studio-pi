import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventLoopLagSampler } from '../diagnostics'

describe('EventLoopLagSampler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not leak the previous interval when started again', () => {
    vi.useFakeTimers()
    const sampler = new EventLoopLagSampler(10, 50)

    sampler.start(performance.now())
    sampler.start(performance.now())
    sampler.stop()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets counters between sampling windows', () => {
    vi.useFakeTimers()
    const sampler = new EventLoopLagSampler(10, 50)

    sampler.start(performance.now())
    vi.advanceTimersByTime(30)
    const first = sampler.stop()
    expect(first.fires).toBeGreaterThan(0)

    sampler.start(performance.now())
    const second = sampler.stop()

    expect(second.fires).toBe(0)
    expect(second.totalLag).toBe(0)
    expect(second.maxLag).toBe(0)
    expect(second.spikes).toEqual([])
  })

  it('returns a stable spike snapshot after stop', () => {
    vi.useFakeTimers()
    const sampler = new EventLoopLagSampler(10, 50)
    const internals = sampler as unknown as { spikes: Array<{ at: number; lag: number }> }

    sampler.start(performance.now())
    internals.spikes.push({ at: 1, lag: 100 })
    const first = sampler.stop()
    expect(first.spikes.length).toBeGreaterThan(0)

    sampler.start(performance.now())
    sampler.stop()

    expect(first.spikes.length).toBeGreaterThan(0)
  })
})
