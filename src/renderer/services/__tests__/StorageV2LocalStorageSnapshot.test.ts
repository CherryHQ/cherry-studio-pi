import { RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY } from '@shared/data/cache/cacheSchemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyStorageV2LocalStorageSnapshot,
  flushStorageV2LocalStorageMirror,
  flushStorageV2LocalStorageMirrorStrict,
  getStorageV2LocalStorageMirrorStatus,
  getStorageV2LocalStorageSnapshot,
  notifyStorageV2MirroredLocalStorageKeyChanged,
  scheduleStorageV2LocalStorageMirror,
  suspendStorageV2LocalStorageMirrorUntilReload
} from '../StorageV2LocalStorageSnapshot'

describe('StorageV2LocalStorageSnapshot', () => {
  let originalApi: unknown

  beforeEach(() => {
    originalApi = window.api
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('captures only durable localStorage values and MCP provider tokens', () => {
    localStorage.setItem('language', 'zh-CN')
    localStorage.setItem('memory_currentUserId', 'user-1')
    localStorage.setItem('privacy-popup-accepted', 'true')
    localStorage.setItem('mcprouter_token', 'mcprouter-secret')
    localStorage.setItem('modelscope_token', 'modelscope-secret')
    localStorage.setItem('unrelated-cache-key', 'ignore-me')

    expect(getStorageV2LocalStorageSnapshot()).toEqual({
      clearedMcpProviderTokenKeys: [],
      durableValues: {
        language: 'zh-CN',
        memory_currentUserId: 'user-1',
        'privacy-popup-accepted': 'true'
      },
      mcpProviderTokenClearMode: 'explicit',
      mcpProviderTokens: {
        mcprouter_token: 'mcprouter-secret',
        modelscope_token: 'modelscope-secret'
      }
    })
  })

  it('captures renderer persist cache with schema whitelisting', () => {
    localStorage.setItem(
      RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        'ui.sidebar.width': 280,
        'ui.emoji.recently_used': ['sparkles'],
        'feature.mcp.is_uv_installed': 'yes',
        'ui.assistant.multi_model_ids': {
          assistant_valid: ['model-a', 'model-b'],
          assistant_invalid: [1, null]
        },
        'unknown.large.cache': 'ignore-me'
      })
    )

    const snapshot = getStorageV2LocalStorageSnapshot()

    expect(JSON.parse(snapshot.durableValues[RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY])).toEqual({
      'ui.sidebar.width': 280,
      'ui.assistant.multi_model_ids': {
        assistant_valid: ['model-a', 'model-b']
      },
      'ui.emoji.recently_used': ['sparkles']
    })
  })

  it('returns an empty snapshot when browser localStorage reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(getStorageV2LocalStorageSnapshot()).toEqual({
      clearedMcpProviderTokenKeys: [],
      durableValues: {},
      mcpProviderTokenClearMode: 'explicit',
      mcpProviderTokens: {}
    })
  })

  it('does not mirror renderer persist cache when it only contains defaults', () => {
    localStorage.setItem(
      RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        'ui.tab.pinned_tabs': [],
        'ui.sidebar.width': 50,
        'settings.provider.last_selected_provider_id': null
      })
    )

    expect(getStorageV2LocalStorageSnapshot().durableValues).not.toHaveProperty(
      RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY
    )
  })

  it('restores durable localStorage values and MCP provider tokens into localStorage', () => {
    localStorage.setItem('mcprouter_token', 'old-token')

    applyStorageV2LocalStorageSnapshot({
      clearedMcpProviderTokenKeys: ['mcprouter_token', 'unexpected_token'],
      durableValues: {
        language: 'zh-CN',
        'onboarding-completed': 'true',
        unexpected_key: 'ignored'
      },
      mcpProviderTokenClearMode: 'explicit',
      mcpProviderTokens: {
        ai302_token: 'ai302-secret',
        bailian_token: 'bailian-secret',
        unexpected_token: 'ignored'
      }
    })

    expect(localStorage.getItem('language')).toBe('zh-CN')
    expect(localStorage.getItem('onboarding-completed')).toBe('true')
    expect(localStorage.getItem('unexpected_key')).toBeNull()
    expect(localStorage.getItem('mcprouter_token')).toBeNull()
    expect(localStorage.getItem('ai302_token')).toBe('ai302-secret')
    expect(localStorage.getItem('bailian_token')).toBe('bailian-secret')
    expect(localStorage.getItem('unexpected_token')).toBeNull()
  })

  it('does not throw when browser localStorage writes are blocked during restore', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(() =>
      applyStorageV2LocalStorageSnapshot({
        clearedMcpProviderTokenKeys: ['mcprouter_token'],
        durableValues: {
          language: 'zh-CN'
        },
        mcpProviderTokenClearMode: 'explicit',
        mcpProviderTokens: {
          ai302_token: 'ai302-secret'
        }
      })
    ).not.toThrow()
  })

  it('ignores legacy MCP provider token clear markers without an explicit clear mode', () => {
    localStorage.setItem('mcprouter_token', 'keep-token')

    applyStorageV2LocalStorageSnapshot({
      clearedMcpProviderTokenKeys: ['mcprouter_token'],
      durableValues: {},
      mcpProviderTokens: {}
    })

    expect(localStorage.getItem('mcprouter_token')).toBe('keep-token')
  })

  it('restores renderer persist cache with schema whitelisting', () => {
    applyStorageV2LocalStorageSnapshot({
      durableValues: {
        [RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY]: JSON.stringify({
          'ui.tab.pinned_tabs': [
            {
              id: 'assistant-list',
              type: 'route',
              url: '/assistants',
              title: 'Assistants',
              lastAccessTime: 100,
              isPinned: true,
              unsafeField: 'ignored'
            },
            {
              id: 'broken-tab'
            }
          ],
          'settings.provider.last_selected_provider_id': 'openai',
          'settings.provider.openai.alert.dismissed': 'true',
          unexpected_key: 'ignored'
        })
      }
    })

    expect(JSON.parse(localStorage.getItem(RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY) ?? '{}')).toEqual({
      'ui.tab.pinned_tabs': [
        {
          id: 'assistant-list',
          type: 'route',
          url: '/assistants',
          title: 'Assistants',
          lastAccessTime: 100,
          isPinned: true
        }
      ],
      'settings.provider.last_selected_provider_id': 'openai'
    })
  })

  it('mirrors the current localStorage snapshot to Storage v2 on demand', async () => {
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('onboarding-completed', 'true')
    localStorage.setItem('bailian_token', 'bailian-secret')

    await flushStorageV2LocalStorageMirror()

    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(
      {
        localStorage: {
          clearedMcpProviderTokenKeys: [],
          durableValues: {
            'onboarding-completed': 'true'
          },
          mcpProviderTokenClearMode: 'explicit',
          mcpProviderTokens: {
            bailian_token: 'bailian-secret'
          }
        }
      },
      { dryRun: false }
    )
  })

  it('flushes scheduled durable localStorage mirrors immediately by default', async () => {
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('privacy-popup-accepted', 'true')

    scheduleStorageV2LocalStorageMirror()

    await vi.waitFor(() => {
      expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    })
  })

  it('schedules a mirror only for Storage v2 mirrored localStorage keys', async () => {
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    localStorage.setItem('transient-ui-cache', 'ignore')
    notifyStorageV2MirroredLocalStorageKeyChanged('transient-ui-cache')
    await Promise.resolve()

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    localStorage.setItem('mcprouter_token', 'secret')
    notifyStorageV2MirroredLocalStorageKeyChanged('mcprouter_token')

    await vi.waitFor(() => {
      expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    })
  })

  it('mirrors MCP provider token deletion only after an explicit clear notification', async () => {
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    localStorage.setItem('mcprouter_token', 'secret')
    localStorage.removeItem('mcprouter_token')
    notifyStorageV2MirroredLocalStorageKeyChanged('mcprouter_token', { cleared: true })

    await vi.waitFor(() => {
      expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(
        {
          localStorage: expect.objectContaining({
            clearedMcpProviderTokenKeys: ['mcprouter_token'],
            mcpProviderTokenClearMode: 'explicit'
          })
        },
        { dryRun: false }
      )
    })
  })

  it('retries durable localStorage mirrors after a transient Storage v2 failure', async () => {
    vi.useFakeTimers()
    const importLegacyReduxSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValueOnce({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('memory_currentUserId', 'user-retry')

    await flushStorageV2LocalStorageMirror()
    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(2)
    expect(importLegacyReduxSnapshot).toHaveBeenLastCalledWith(
      {
        localStorage: expect.objectContaining({
          durableValues: {
            memory_currentUserId: 'user-retry'
          }
        })
      },
      { dryRun: false }
    )
  })

  it('rejects strict durable localStorage flushes while a failed mirror is pending retry', async () => {
    vi.useFakeTimers()
    const importLegacyReduxSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValueOnce({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('language', 'strict-zh')

    await expect(flushStorageV2LocalStorageMirrorStrict()).rejects.toThrow('database busy')
    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(2)
  })

  it('rejects strict durable localStorage flushes when Storage v2 API is unavailable after scheduling', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
    localStorage.setItem('language', 'api-missing')

    scheduleStorageV2LocalStorageMirror()

    await expect(flushStorageV2LocalStorageMirrorStrict()).rejects.toThrow(
      'Storage v2 API unavailable while durable localStorage mirror work is pending'
    )

    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    await flushStorageV2LocalStorageMirror()
    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('retries scheduled durable localStorage mirrors when the Storage v2 API becomes available later', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
    localStorage.setItem('language', 'api-later')

    scheduleStorageV2LocalStorageMirror()

    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    await vi.advanceTimersByTimeAsync(5000)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(
      {
        localStorage: expect.objectContaining({
          durableValues: {
            language: 'api-later'
          }
        })
      },
      { dryRun: false }
    )
  })

  it('does not keep the renderer process alive while debounce flushing durable localStorage mirrors', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    scheduleStorageV2LocalStorageMirror(1000)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(unref).toHaveBeenCalledTimes(1)

    await flushStorageV2LocalStorageMirror()
  })

  it('does not keep retrying after a durable localStorage write fails during renderer teardown', async () => {
    vi.useFakeTimers()
    const originalWindow = globalThis.window
    const importLegacyReduxSnapshot = vi.fn().mockImplementation(async () => {
      vi.stubGlobal('window', undefined)
      throw new Error('renderer ipc closed')
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('language', 'teardown-zh')

    try {
      await flushStorageV2LocalStorageMirror()
      await vi.advanceTimersByTimeAsync(5000)

      expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
      expect(getStorageV2LocalStorageMirrorStatus().pendingCount).toBe(1)
    } finally {
      vi.stubGlobal('window', originalWindow)
    }
  })

  it('suspends scheduled durable localStorage mirrors until reload after restore', async () => {
    vi.useFakeTimers()
    const importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
    localStorage.setItem('privacy-popup-accepted', 'restore-safe')

    scheduleStorageV2LocalStorageMirror(1000)
    suspendStorageV2LocalStorageMirrorUntilReload()
    await vi.advanceTimersByTimeAsync(1000)
    await flushStorageV2LocalStorageMirrorStrict()

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()
  })
})
