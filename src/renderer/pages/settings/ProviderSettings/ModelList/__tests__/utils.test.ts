import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { getModelClipboardId, getProviderModelApiId } from '../utils'

describe('ProviderSettings ModelList utils', () => {
  it('resolves provider model api ids from apiModelId first', () => {
    expect(
      getProviderModelApiId({
        id: 'openai::internal-gpt-4o',
        apiModelId: 'gpt-4o'
      } as unknown as Model)
    ).toBe('gpt-4o')
  })

  it('resolves provider model api ids from UniqueModelId values', () => {
    expect(
      getProviderModelApiId({
        id: 'openai::gpt-4o',
        apiModelId: undefined
      } as unknown as Model)
    ).toBe('gpt-4o')
  })

  it('falls back to raw legacy ids instead of throwing', () => {
    expect(
      getProviderModelApiId({
        id: 'legacy-gpt-4o',
        apiModelId: undefined
      } as unknown as Model)
    ).toBe('legacy-gpt-4o')
  })

  it('uses model name as clipboard fallback only when no id can be resolved', () => {
    expect(
      getModelClipboardId({
        id: '',
        apiModelId: undefined,
        name: 'Display Name'
      } as unknown as Model)
    ).toBe('Display Name')
  })
})
