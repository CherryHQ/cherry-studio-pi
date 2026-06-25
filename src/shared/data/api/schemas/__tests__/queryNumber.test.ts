import { describe, expect, it } from 'vitest'

import { ListAgentsQuerySchema, ListQuerySchema } from '../agents'
import { ListAssistantsQuerySchema } from '../assistants'
import { ListKnowledgeBasesQuerySchema, ListKnowledgeItemsQuerySchema } from '../knowledges'
import { ListPaintingsQuerySchema } from '../paintings'
import { TranslateHistoryQuerySchema } from '../translate'

describe('numeric DataApi query params', () => {
  it('accepts URL-style numeric strings for pagination filters', () => {
    expect(ListQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListAgentsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListAssistantsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListKnowledgeBasesQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListKnowledgeItemsQuerySchema.parse({ cursor: 'cursor-1', limit: '50' })).toMatchObject({
      cursor: 'cursor-1',
      limit: 50
    })
    expect(ListPaintingsQuerySchema.parse({ limit: '50' })).toMatchObject({ limit: 50 })
    expect(TranslateHistoryQuerySchema.parse({ limit: '50' })).toMatchObject({ limit: 50 })
  })

  it('keeps rejecting blank, non-numeric, fractional, and oversized values', () => {
    expect(() => ListQuerySchema.parse({ page: '', limit: '50' })).toThrow()
    expect(() => ListQuerySchema.parse({ page: 'abc', limit: '50' })).toThrow()
    expect(() => ListQuerySchema.parse({ page: '1.5', limit: '50' })).toThrow()
    expect(() => ListQuerySchema.parse({ page: '1', limit: '501' })).toThrow()
  })
})
