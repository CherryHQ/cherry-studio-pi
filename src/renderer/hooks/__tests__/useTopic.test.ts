import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { finishTopicRenaming, startTopicRenaming, useTopicMutations } from '../useTopic'

const cacheMocks = vi.hoisted(() => {
  const store = new Map<string, string[]>()

  return {
    store,
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: string[]) => {
      store.set(key, value)
    })
  }
})

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: cacheMocks.get,
    set: cacheMocks.set
  }
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { CHANGE_TOPIC: 'change-topic' },
  EventEmitter: { emit: vi.fn() }
}))

describe('topic rename cache helpers', () => {
  beforeEach(() => {
    cacheMocks.store.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('deduplicates topics while starting rename', () => {
    cacheMocks.store.set('topic.renaming', ['topic-a'])

    startTopicRenaming('topic-a')

    expect(cacheMocks.store.get('topic.renaming')).toEqual(['topic-a'])
  })

  it('keeps newly renamed state visible after repeated finish events', () => {
    vi.useFakeTimers()
    cacheMocks.store.set('topic.renaming', ['topic-a'])

    finishTopicRenaming('topic-a')
    expect(cacheMocks.store.get('topic.renaming')).toEqual([])
    expect(cacheMocks.store.get('topic.newly_renamed')).toEqual(['topic-a'])

    vi.advanceTimersByTime(500)
    finishTopicRenaming('topic-a')

    expect(cacheMocks.store.get('topic.newly_renamed')).toEqual(['topic-a'])

    vi.advanceTimersByTime(699)
    expect(cacheMocks.store.get('topic.newly_renamed')).toEqual(['topic-a'])

    vi.advanceTimersByTime(1)
    expect(cacheMocks.store.get('topic.newly_renamed')).toEqual([])
  })
})

describe('useTopicMutations', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    cacheMocks.store.clear()
    vi.clearAllMocks()
  })

  it('deletes selected topics through comma-separated query ids', async () => {
    const response = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
    const deleteTrigger = vi.fn().mockResolvedValue(response)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    const deleted = await act(async () => result.current.deleteTopics(['topic-a', 'topic-b']))

    expect(deleteTrigger).toHaveBeenCalledWith({ query: { ids: 'topic-a,topic-b' } })
    expect(deleted).toBe(response)
  })

  it('refreshes topic and pin caches after deleting one topic', async () => {
    const deleteTrigger = vi.fn().mockResolvedValueOnce(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics/:id', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    await act(async () => result.current.deleteTopic('topic-a'))

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'topic-a' } })
    expect(mockUseMutation).toHaveBeenCalledWith('DELETE', '/topics/:id', {
      refresh: ['/topics', '/pins']
    })
  })

  it('exposes selected-topic delete loading through isDeleting', () => {
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics', vi.fn(), { isLoading: true })

    const { result } = renderHook(() => useTopicMutations())

    expect(result.current.isDeleting).toBe(true)
  })
})
