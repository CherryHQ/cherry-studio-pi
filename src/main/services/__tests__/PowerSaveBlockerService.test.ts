import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  powerSaveBlocker: {
    start: vi.fn(),
    stop: vi.fn(),
    isStarted: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: mocks.loggerWarn,
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  powerSaveBlocker: mocks.powerSaveBlocker
}))

import powerSaveBlockerService from '../PowerSaveBlockerService'

describe('PowerSaveBlockerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.powerSaveBlocker.start.mockReturnValue(1)
    mocks.powerSaveBlocker.stop.mockReturnValue(true)
    mocks.powerSaveBlocker.isStarted.mockReturnValue(true)
    powerSaveBlockerService.releaseAll('test-reset')
  })

  it('acquires and releases a blocker once', () => {
    const lease = powerSaveBlockerService.acquire('test-task')

    expect(mocks.powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')
    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(1)

    lease.release()
    lease.release()

    expect(mocks.powerSaveBlocker.stop).toHaveBeenCalledTimes(1)
    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
  })

  it('releases blocker after successful task', async () => {
    const result = await powerSaveBlockerService.runWithBlocker('test-task', async () => 'ok')

    expect(result).toBe('ok')
    expect(mocks.powerSaveBlocker.stop).toHaveBeenCalledTimes(1)
    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
  })

  it('releases blocker after failed task', async () => {
    await expect(
      powerSaveBlockerService.runWithBlocker('test-task', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(mocks.powerSaveBlocker.stop).toHaveBeenCalledTimes(1)
    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
  })

  it('releases all active blockers', () => {
    mocks.powerSaveBlocker.start.mockReturnValueOnce(1).mockReturnValueOnce(2)

    powerSaveBlockerService.acquire('task-a')
    powerSaveBlockerService.acquire('task-b')

    powerSaveBlockerService.releaseAll('test')

    expect(mocks.powerSaveBlocker.stop).toHaveBeenCalledTimes(2)
    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
  })

  it('preserves structured acquire failures in logs', () => {
    mocks.powerSaveBlocker.start.mockImplementationOnce(() => {
      throw {
        response: {
          status: 503,
          statusText: 'Service Unavailable'
        }
      }
    })

    const lease = powerSaveBlockerService.acquire('test-task')

    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to acquire power save blocker', {
      reason: 'test-task',
      type: 'prevent-app-suspension',
      detail: undefined,
      error: '503 Service Unavailable'
    })

    lease.release()
    expect(mocks.powerSaveBlocker.stop).not.toHaveBeenCalled()
  })

  it('preserves structured release failures in logs', () => {
    mocks.powerSaveBlocker.stop.mockImplementationOnce(() => {
      throw {
        cause: {
          code: 'POWER_BLOCKER_RELEASE_FAILED'
        }
      }
    })

    const lease = powerSaveBlockerService.acquire('test-task')
    lease.release()

    expect(powerSaveBlockerService.getActiveBlockers()).toHaveLength(0)
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to release power save blocker',
      expect.objectContaining({
        reason: 'test-task',
        type: 'prevent-app-suspension',
        error: 'POWER_BLOCKER_RELEASE_FAILED'
      })
    )
  })
})
