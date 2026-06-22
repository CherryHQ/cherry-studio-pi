import { loggerService } from '@logger'
import { getErrorMessage } from '@main/utils/errorMessage'
import { powerSaveBlocker } from 'electron'

const logger = loggerService.withContext('PowerSaveBlockerService')

type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep'

export type PowerSaveBlockerLease = {
  key: string
  release: () => void
}

type ActivePowerSaveBlocker = {
  blockerId: number
  reason: string
  type: PowerSaveBlockerType
  detail?: string
  startedAt: number
}

function errorMessage(error: unknown) {
  return getErrorMessage(error, 'Unknown power save blocker error')
}

class PowerSaveBlockerService {
  private static instance: PowerSaveBlockerService | null = null
  private readonly activeBlockers = new Map<string, ActivePowerSaveBlocker>()
  private sequence = 0

  static getInstance(): PowerSaveBlockerService {
    if (!PowerSaveBlockerService.instance) {
      PowerSaveBlockerService.instance = new PowerSaveBlockerService()
    }
    return PowerSaveBlockerService.instance
  }

  acquire(
    reason: string,
    options: {
      type?: PowerSaveBlockerType
      detail?: string
    } = {}
  ): PowerSaveBlockerLease {
    const type = options.type ?? 'prevent-app-suspension'
    const key = `${Date.now()}-${++this.sequence}-${reason}`

    try {
      const blockerId = powerSaveBlocker.start(type)
      this.activeBlockers.set(key, {
        blockerId,
        reason,
        type,
        detail: options.detail,
        startedAt: Date.now()
      })
      logger.info('Power save blocker acquired', {
        key,
        reason,
        type,
        activeCount: this.activeBlockers.size,
        detail: options.detail
      })
    } catch (error) {
      logger.warn('Failed to acquire power save blocker', {
        reason,
        type,
        detail: options.detail,
        error: errorMessage(error)
      })
    }

    let released = false
    return {
      key,
      release: () => {
        if (released) return
        released = true
        this.release(key)
      }
    }
  }

  async runWithBlocker<T>(
    reason: string,
    task: () => Promise<T>,
    options: {
      type?: PowerSaveBlockerType
      detail?: string
    } = {}
  ): Promise<T> {
    const lease = this.acquire(reason, options)
    try {
      return await task()
    } finally {
      lease.release()
    }
  }

  release(key: string): void {
    const active = this.activeBlockers.get(key)
    if (!active) return

    this.activeBlockers.delete(key)

    try {
      if (powerSaveBlocker.isStarted(active.blockerId)) {
        powerSaveBlocker.stop(active.blockerId)
      }
      logger.info('Power save blocker released', {
        key,
        reason: active.reason,
        type: active.type,
        durationMs: Date.now() - active.startedAt,
        activeCount: this.activeBlockers.size
      })
    } catch (error) {
      logger.warn('Failed to release power save blocker', {
        key,
        reason: active.reason,
        type: active.type,
        error: errorMessage(error)
      })
    }
  }

  releaseAll(reason: string = 'release-all'): void {
    for (const key of Array.from(this.activeBlockers.keys())) {
      this.release(key)
    }
    logger.info('All power save blockers released', { reason })
  }

  getActiveBlockers(): ActivePowerSaveBlocker[] {
    return Array.from(this.activeBlockers.values())
  }
}

export const powerSaveBlockerService = PowerSaveBlockerService.getInstance()
export default powerSaveBlockerService
