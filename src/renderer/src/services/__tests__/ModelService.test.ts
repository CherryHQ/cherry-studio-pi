import type { Model } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('../ProviderService', () => ({
  getProviderName: vi.fn(() => 'Provider')
}))

import { findModelByUniqId, getModelUniqId, parseModelUniqId } from '../ModelService'

const models = [
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT 4.1' },
  { id: 'claude-sonnet', provider: 'anthropic', name: 'Claude Sonnet' }
] as Model[]

describe('ModelService model uniq ids', () => {
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
})
