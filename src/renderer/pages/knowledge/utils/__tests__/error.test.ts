import { describe, expect, it } from 'vitest'

import { normalizeKnowledgeError } from '../error'

describe('knowledge error utilities', () => {
  it('preserves nested IPC bridge error details', () => {
    expect(normalizeKnowledgeError({ error: { message: 'knowledge bridge failed' } }).message).toBe(
      'knowledge bridge failed'
    )
  })
})
