import { Application } from '@main/core/application/Application'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('JobManager timer lifecycle', () => {
  beforeEach(() => {
    BaseService.resetInstances()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
  })

  it('does not keep the process alive while waiting to run startup recovery', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)

    const jobManager = new JobManager()
    await jobManager._doAllReady()

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000)
    expect(unref).toHaveBeenCalledTimes(1)

    await jobManager._doStop()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
  })

  it('does not keep the process alive while waiting for in-flight jobs to stop', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)

    const jobManager = new JobManager()
    ;(
      jobManager as unknown as {
        abortControllers: Map<string, AbortController>
        inFlightExecuted: Map<string, Promise<void>>
      }
    ).abortControllers.set('job-1', new AbortController())
    ;(
      jobManager as unknown as {
        abortControllers: Map<string, AbortController>
        inFlightExecuted: Map<string, Promise<void>>
      }
    ).inFlightExecuted.set('job-1', Promise.resolve())

    await jobManager._doStop()

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), Application.SHUTDOWN_TIMEOUT_MS)
    expect(unref).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
  })
})
