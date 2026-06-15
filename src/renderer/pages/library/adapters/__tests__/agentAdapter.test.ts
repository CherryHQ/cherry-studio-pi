import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentMutationsById } from '../agentAdapter'

const useMutationMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: vi.fn()
}))

describe('useAgentMutationsById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReturnValue({
      trigger: vi.fn(),
      isLoading: false,
      error: undefined
    })
  })

  it('refreshes agent, session, and pin caches after deleting from the library adapter', () => {
    renderHook(() => useAgentMutationsById('agent-1'))

    expect(useMutationMock).toHaveBeenCalledWith('DELETE', '/agents/agent-1', {
      refresh: ['/agents', '/agent-sessions', '/pins']
    })
  })
})
