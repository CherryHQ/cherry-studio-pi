import { describe, expect, it } from 'vitest'

import {
  decodeStorageV2CompositeEntityId,
  encodeStorageV2CompositeEntityId,
  listStorageV2CompositeEntityIdCandidates
} from '../SyncEntityId'

describe('Storage v2 sync entity ids', () => {
  it('encodes composite ids without losing separator characters', () => {
    const encoded = encodeStorageV2CompositeEntityId(['provider:custom', 'apiKey'])

    expect(encoded).toBe('["provider:custom","apiKey"]')
    expect(decodeStorageV2CompositeEntityId(encoded, 2)).toEqual(['provider:custom', 'apiKey'])
  })

  it('keeps legacy colon-joined tombstones readable', () => {
    expect(decodeStorageV2CompositeEntityId('provider-1:apiKey', 2)).toEqual(['provider-1', 'apiKey'])
    expect(listStorageV2CompositeEntityIdCandidates(['provider-1', 'apiKey'])).toEqual([
      '["provider-1","apiKey"]',
      'provider-1:apiKey'
    ])
  })

  it('rejects ambiguous legacy ids with extra separators', () => {
    expect(decodeStorageV2CompositeEntityId('provider:custom:apiKey', 2)).toBeNull()
  })
})
