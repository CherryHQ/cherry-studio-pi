import { describe, expect, it, vi } from 'vitest'

import { persistProviderTokenInput } from '../McpProviderSettings'

describe('McpProviderSettings token persistence', () => {
  it('saves trimmed non-empty tokens', () => {
    const provider = {
      clearToken: vi.fn(),
      saveToken: vi.fn()
    }

    expect(persistProviderTokenInput(provider, '  api-token  ')).toBe('api-token')

    expect(provider.saveToken).toHaveBeenCalledWith('api-token')
    expect(provider.clearToken).not.toHaveBeenCalled()
  })

  it('clears the saved token when the input is empty or whitespace', () => {
    const provider = {
      clearToken: vi.fn(),
      saveToken: vi.fn()
    }

    expect(persistProviderTokenInput(provider, '   ')).toBe('')

    expect(provider.clearToken).toHaveBeenCalledTimes(1)
    expect(provider.saveToken).not.toHaveBeenCalled()
  })
})
