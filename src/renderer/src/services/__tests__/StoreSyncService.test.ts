import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

import storeSyncService from '../StoreSyncService'

describe('StoreSyncService', () => {
  const subscribe = vi.fn()
  const unsubscribe = vi.fn()
  const removeIpcListener = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(storeSyncService as any).broadcastSyncRemover = null
    ;(window as any).api = {
      storeSync: {
        subscribe,
        unsubscribe,
        onUpdate: vi.fn()
      }
    }
    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn(() => removeIpcListener)
      }
    }
  })

  afterEach(() => {
    storeSyncService.unsubscribe()
  })

  it('removes its beforeunload handler when unsubscribing', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')

    storeSyncService.subscribe()
    storeSyncService.unsubscribe()

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalled()
    expect(removeIpcListener).toHaveBeenCalledTimes(1)
    expect(
      addEventListener.mock.calls.map(([event]) => String(event)).filter((event) => event === 'beforeunload')
    ).toHaveLength(1)
    expect(
      removeEventListener.mock.calls.map(([event]) => String(event)).filter((event) => event === 'beforeunload')
    ).toHaveLength(1)

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })
})
