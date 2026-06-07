import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getShared: vi.fn(),
  subscribe: vi.fn()
}))

vi.mock('@renderer/data/CacheService', () => ({
  cacheService: {
    getShared: mocks.getShared,
    subscribe: mocks.subscribe
  }
}))

import { useMcpRuntimeStatusMap } from '../useMcpRuntimeStatus'

describe('useMcpRuntimeStatusMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getShared.mockReturnValue(undefined)
    mocks.subscribe.mockReturnValue(vi.fn())
  })

  it('refreshes the default status when an existing server becomes active', async () => {
    const { result, rerender } = renderHook(({ isActive }) => useMcpRuntimeStatusMap([{ id: 'server-1', isActive }]), {
      initialProps: { isActive: false }
    })

    expect(result.current['server-1']).toEqual({ state: 'disabled', lastCheckedAt: 0 })

    rerender({ isActive: true })

    await waitFor(() => {
      expect(result.current['server-1']).toEqual({ state: 'connecting', lastCheckedAt: 0 })
    })
  })
})
