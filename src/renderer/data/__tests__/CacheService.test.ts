/**
 * Tests for renderer-side CacheService value-equality semantics.
 *
 * This is the first unit test for the renderer CacheService itself (prior
 * coverage was limited to useCache hook type tests). It locks down the
 * Object.is → lodash.isEqual upgrade for setInternal / setSharedInternal,
 * and the deepEqual → isEqual refactor for setPersist, focusing on the
 * scenarios the upgrade actually changes: object/array/record values that
 * are reconstructed as new references on every write.
 */
import { RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY } from '@shared/data/cache/cacheSchemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from renderer.setup.ts — we want the REAL CacheService
vi.unmock('@data/CacheService')

const broadcastSync = vi.fn()
const onSync = vi.fn()
const getAllShared = vi.fn(async () => ({}))

beforeEach(() => {
  broadcastSync.mockClear()
  onSync.mockClear()
  getAllShared.mockClear()
  localStorage.clear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        onSync,
        getAllShared
      }
    }
  })
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

async function createService() {
  const { CacheService } = await import('../CacheService')
  return new CacheService()
}

describe('renderer CacheService equality semantics', () => {
  describe('setInternal (memory cache)', () => {
    it('skips subscriber notification when object value has same content (new reference)', async () => {
      const service = await createService()
      const sub = vi.fn()
      const key = 'agent.session.waiting_id_map'

      service.set(key, { a: true, b: false })
      service.subscribe(key, sub)
      sub.mockClear()

      service.set(key, { a: true, b: false }) // new reference, same content
      expect(sub).not.toHaveBeenCalled()
    })

    it('notifies subscribers when content actually changes', async () => {
      const service = await createService()
      const sub = vi.fn()
      const key = 'agent.session.waiting_id_map'

      service.set(key, { a: true })
      service.subscribe(key, sub)
      sub.mockClear()

      service.set(key, { a: true, b: false })
      expect(sub).toHaveBeenCalledTimes(1)
    })
  })

  describe('setSharedInternal (shared cache)', () => {
    it('skips cross-window broadcast when Record value has same content (new reference)', async () => {
      const service = await createService()
      const key = 'chat.web_search.active_searches'
      // `chat.web_search.active_searches` is `Record<string, ...>` — exactly the
      // case the Object.is → isEqual upgrade is meant to fix.
      service.setShared(key, { topic1: { status: 'running' } } as any)
      broadcastSync.mockClear()

      service.setShared(key, { topic1: { status: 'running' } } as any) // new ref, same content
      expect(broadcastSync).not.toHaveBeenCalled()
    })

    it('broadcasts when Record value content actually changes', async () => {
      const service = await createService()
      const key = 'chat.web_search.active_searches'
      service.setShared(key, { topic1: { status: 'running' } } as any)
      broadcastSync.mockClear()

      service.setShared(key, { topic1: { status: 'done' } } as any)
      expect(broadcastSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('setPersist', () => {
    it('skips persist save when array value has same content (new reference)', async () => {
      const service = await createService()
      const key = 'ui.tab.pinned_tabs'

      service.setPersist(key, [{ id: 't1' }] as any)
      broadcastSync.mockClear()

      service.setPersist(key, [{ id: 't1' }] as any) // new ref, same content
      expect(broadcastSync).not.toHaveBeenCalled()
    })

    it('broadcasts when array content actually changes', async () => {
      const service = await createService()
      const key = 'ui.tab.pinned_tabs'

      service.setPersist(key, [{ id: 't1' }] as any)
      broadcastSync.mockClear()

      service.setPersist(key, [{ id: 't1' }, { id: 't2' }] as any)
      expect(broadcastSync).toHaveBeenCalledTimes(1)
    })

    it('reloads restored persist cache from localStorage into active windows', async () => {
      const service = await createService()
      const key = 'ui.sidebar.width'
      const sub = vi.fn()

      service.subscribe(key, sub)
      localStorage.setItem(
        RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
        JSON.stringify({
          [key]: 320
        })
      )
      broadcastSync.mockClear()

      service.reloadPersistCacheFromStorage()

      expect(service.getPersist(key)).toBe(320)
      expect(sub).toHaveBeenCalledTimes(1)
      expect(broadcastSync).toHaveBeenCalledWith({
        type: 'persist',
        key,
        value: 320
      })
    })

    it('drops invalid persisted localStorage values while loading defaults', async () => {
      localStorage.setItem(
        RENDERER_PERSIST_CACHE_LOCAL_STORAGE_KEY,
        JSON.stringify({
          'ui.sidebar.width': 'wide',
          'settings.provider.openai.alert.dismissed': 'true',
          'ui.emoji.recently_used': ['🧠', 42],
          'ui.tab.pinned_tabs': [
            {
              id: 'valid-tab',
              type: 'route',
              url: '/home',
              title: 'Home'
            },
            {
              id: 'broken-tab'
            }
          ]
        })
      )

      const service = await createService()

      expect(service.getPersist('ui.sidebar.width')).toBe(65)
      expect(service.getPersist('settings.provider.openai.alert.dismissed')).toBe(false)
      expect(service.getPersist('ui.emoji.recently_used')).toEqual(['🧠'])
      expect(service.getPersist('ui.tab.pinned_tabs')).toEqual([
        {
          id: 'valid-tab',
          type: 'route',
          url: '/home',
          title: 'Home'
        }
      ])
    })
  })
})
