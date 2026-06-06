import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('../ProviderService', () => ({
  getProviderName: vi.fn(() => 'Provider')
}))

import { getStoreProviders } from '@renderer/hooks/useStore'

import { findModelByUniqId, getModelById, getModelUniqId, hasModel, parseModelUniqId } from '../ModelService'

const models = [
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT 4.1' },
  { id: 'claude-sonnet', provider: 'anthropic', name: 'Claude Sonnet' }
] as Model[]

describe('ModelService model uniq ids', () => {
  beforeEach(() => {
    vi.mocked(getStoreProviders).mockReturnValue([])
  })

  it('parses valid model uniq ids', () => {
    const value = getModelUniqId(models[0])

    expect(parseModelUniqId(value)).toEqual({ id: 'gpt-4.1', provider: 'openai' })
  })

  it('returns null for malformed model uniq ids', () => {
    expect(parseModelUniqId(undefined)).toBeNull()
    expect(parseModelUniqId('%not-json')).toBeNull()
    expect(parseModelUniqId(JSON.stringify({ id: 'missing-provider' }))).toBeNull()
  })

  it('finds models from a safe parsed uniq id', () => {
    expect(findModelByUniqId(models, getModelUniqId(models[1]))).toBe(models[1])
    expect(findModelByUniqId(models, '%not-json')).toBeUndefined()
  })

  it('checks model availability by provider and id instead of id alone', () => {
    vi.mocked(getStoreProviders).mockReturnValue([
      {
        id: 'openai',
        enabled: false,
        models: [{ id: 'shared-model', provider: 'openai', name: 'Disabled OpenAI Model' }]
      },
      {
        id: 'anthropic',
        enabled: true,
        models: [{ id: 'shared-model', name: 'Enabled Anthropic Model' }]
      }
    ] as any)

    expect(hasModel({ id: 'shared-model', provider: 'openai' } as Model)).toBe(false)
    expect(hasModel({ id: 'shared-model', provider: 'anthropic' } as Model)).toBe(true)
    expect(getModelById('shared-model')?.provider).toBe('anthropic')
  })
})
