import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('StorageV2AgentMirrorService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('rejects strict flushes when the agent database mirror is still pending after failure', async () => {
    const importLegacyAgentDb = vi.fn().mockRejectedValue(new Error('agents.db locked'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyAgentDb
        }
      }
    })

    const { storageV2AgentMirrorService } = await import('../StorageV2AgentMirrorService')

    storageV2AgentMirrorService.schedule(1000)

    await expect(storageV2AgentMirrorService.flushStrict()).rejects.toThrow('agents.db locked')
    expect(importLegacyAgentDb).toHaveBeenCalledWith({ dryRun: false, createSnapshot: false })
  })

  it('rejects strict flushes when Storage v2 API is unavailable with pending agent work', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })

    const { storageV2AgentMirrorService } = await import('../StorageV2AgentMirrorService')

    storageV2AgentMirrorService.schedule(1000)

    await expect(storageV2AgentMirrorService.flushStrict()).rejects.toThrow(
      'Storage v2 API unavailable while agent database mirror work is pending'
    )
  })

  it('retries pending agent database mirrors when Storage v2 API becomes available later', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })

    const { storageV2AgentMirrorService } = await import('../StorageV2AgentMirrorService')

    storageV2AgentMirrorService.schedule(1000)
    await storageV2AgentMirrorService.flush()

    const importLegacyAgentDb = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyAgentDb
        }
      }
    })

    await vi.advanceTimersByTimeAsync(3999)
    expect(importLegacyAgentDb).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(importLegacyAgentDb).toHaveBeenCalledWith({ dryRun: false, createSnapshot: false })
  })

  it('does not keep retrying after the renderer window has been torn down', async () => {
    const { storageV2AgentMirrorService } = await import('../StorageV2AgentMirrorService')
    storageV2AgentMirrorService.schedule(1000)

    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await storageV2AgentMirrorService.flush()
      await vi.advanceTimersByTimeAsync(4000)
    } finally {
      vi.stubGlobal('window', originalWindow)
    }

    expect(storageV2AgentMirrorService.getStatus().pendingCount).toBe(1)
  })
})
