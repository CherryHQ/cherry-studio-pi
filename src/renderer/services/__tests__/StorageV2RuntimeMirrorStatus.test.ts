import { describe, expect, it } from 'vitest'

import { serializeStorageV2MirrorError } from '../StorageV2RuntimeMirrorStatus'

describe('StorageV2RuntimeMirrorStatus', () => {
  it('keeps empty mirror errors as null', () => {
    expect(serializeStorageV2MirrorError(null)).toBeNull()
    expect(serializeStorageV2MirrorError(undefined)).toBeNull()
  })

  it('preserves nested IPC bridge error details', () => {
    expect(serializeStorageV2MirrorError({ error: { message: 'mirror write failed' } })).toBe('mirror write failed')
  })
})
