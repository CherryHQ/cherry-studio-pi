import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DATA_SYNC_LOCAL_CHANGE_EVENT,
  notifyDataSyncLocalChange,
  subscribeDataSyncLocalChanges
} from '../DataSyncLocalChangeSignal'

describe('DataSyncLocalChangeSignal', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
  })

  it('notifies subscribers for known local change reasons', () => {
    const listener = vi.fn()
    cleanups.push(subscribeDataSyncLocalChanges(listener))

    notifyDataSyncLocalChange('provider')

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'provider',
        changedAt: expect.any(Number)
      })
    )
  })

  it('ignores malformed events with unknown reasons', () => {
    const listener = vi.fn()
    cleanups.push(subscribeDataSyncLocalChanges(listener))

    window.dispatchEvent(
      new CustomEvent(DATA_SYNC_LOCAL_CHANGE_EVENT, {
        detail: {
          reason: 'unknown-reason',
          changedAt: Date.now()
        }
      })
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes the event listener when unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDataSyncLocalChanges(listener)

    unsubscribe()
    notifyDataSyncLocalChange('assistant')

    expect(listener).not.toHaveBeenCalled()
  })
})
