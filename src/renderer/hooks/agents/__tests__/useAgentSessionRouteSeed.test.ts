import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeAgentSessionRouteSeed, useAgentSessionRouteSeed } from '../useAgentSessionRouteSeed'

const { cacheSetMock } = vi.hoisted(() => ({
  cacheSetMock: vi.fn()
}))

vi.mock('@renderer/data/CacheService', () => ({
  cacheService: {
    set: cacheSetMock
  }
}))

describe('useAgentSessionRouteSeed', () => {
  beforeEach(() => {
    cacheSetMock.mockReset()
  })

  it('normalizes string session ids from route search', () => {
    expect(normalizeAgentSessionRouteSeed(' session-1 ')).toBe('session-1')
    expect(normalizeAgentSessionRouteSeed('')).toBeNull()
    expect(normalizeAgentSessionRouteSeed(['session-1'])).toBeNull()
    expect(normalizeAgentSessionRouteSeed(undefined)).toBeNull()
  })

  it('seeds the active agent session cache from a route session id', async () => {
    renderHook(() => useAgentSessionRouteSeed(' session-1 '))

    await waitFor(() => {
      expect(cacheSetMock).toHaveBeenCalledWith('agent.active_session_id', 'session-1')
    })
  })

  it('ignores invalid route session ids', async () => {
    renderHook(() => useAgentSessionRouteSeed(['session-1']))

    await waitFor(() => {
      expect(cacheSetMock).not.toHaveBeenCalled()
    })
  })
})
