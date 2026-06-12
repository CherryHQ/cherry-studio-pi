import { MockUseCache, MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApi, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentSessionInitializer } from '../useAgentSessionInitializer'

vi.mock('@renderer/data/hooks/useCache', () => MockUseCache)
vi.mock('@data/hooks/useDataApi', () => MockUseDataApi)

const queryResult = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isRefreshing: false,
  error: undefined,
  refetch: vi.fn().mockResolvedValue(undefined),
  mutate: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

const sessionsResult = (items: Array<{ id: string }> = []) =>
  queryResult({
    data: { items, total: items.length, page: 1 }
  })

describe('useAgentSessionInitializer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
  })

  it('sets the first available session when no active session is cached', async () => {
    mockUseQuery.mockImplementation((path, options: any) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/agent-sessions') return sessionsResult([{ id: 'session-1' }])
      return queryResult()
    })

    renderHook(() => useAgentSessionInitializer())

    await waitFor(() => {
      expect(MockUseCacheUtils.getCacheValue('agent.active_session_id')).toBe('session-1')
    })
  })

  it('replaces a stale active session id with the first valid session', async () => {
    MockUseCacheUtils.setCacheValue('agent.active_session_id', 'missing-session')
    mockUseQuery.mockImplementation((path, options: any) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/agent-sessions/:sessionId') {
        return queryResult({ error: new Error('not found') })
      }
      if (path === '/agent-sessions') return sessionsResult([{ id: 'session-1' }])
      return queryResult()
    })

    renderHook(() => useAgentSessionInitializer())

    await waitFor(() => {
      expect(MockUseCacheUtils.getCacheValue('agent.active_session_id')).toBe('session-1')
    })
  })

  it('clears a stale active session id when no sessions exist', async () => {
    MockUseCacheUtils.setCacheValue('agent.active_session_id', 'missing-session')
    mockUseQuery.mockImplementation((path, options: any) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/agent-sessions/:sessionId') {
        return queryResult({ error: new Error('not found') })
      }
      if (path === '/agent-sessions') return sessionsResult([])
      return queryResult()
    })

    renderHook(() => useAgentSessionInitializer())

    await waitFor(() => {
      expect(MockUseCacheUtils.getCacheValue('agent.active_session_id')).toBeNull()
    })
  })
})
