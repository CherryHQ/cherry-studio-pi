import { describe, expect, it } from 'vitest'

import { getRemainingPendingDeleteIds } from '../KnowledgePendingDelete'

describe('KnowledgePendingDelete', () => {
  it('keeps failed pending delete ids for the next startup retry', () => {
    expect(getRemainingPendingDeleteIds(['kb-ok', 'kb-failed', 'kb-failed'], ['kb-ok'])).toEqual(['kb-failed'])
  })

  it('clears all pending ids when every delete succeeds', () => {
    expect(getRemainingPendingDeleteIds(['kb-1', 'kb-2'], ['kb-1', 'kb-2'])).toEqual([])
  })
})
