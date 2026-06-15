import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistantMutations } from '../useAssistant'

describe('useAssistantMutations', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('refreshes assistant and pin caches after deleting an assistant', async () => {
    const deleteTrigger = vi.fn().mockResolvedValueOnce(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/assistants/:id', deleteTrigger)

    const { result } = renderHook(() => useAssistantMutations())
    await act(async () => result.current.deleteAssistant('assistant-1'))

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'assistant-1' } })
    expect(mockUseMutation).toHaveBeenCalledWith('DELETE', '/assistants/:id', {
      refresh: ['/assistants', '/assistants/*', '/pins']
    })
  })
})
