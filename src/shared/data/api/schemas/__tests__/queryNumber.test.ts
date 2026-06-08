import { describe, expect, it } from 'vitest'

import { ListAgentsQuerySchema, ListQuerySchema } from '../agents'
import { ListAssistantsQuerySchema } from '../assistants'
import { LIST_FILES_MAX_LIMIT } from '../files'
import { ListFilesQuerySchema } from '../files'
import { ListKnowledgeBasesQuerySchema, ListKnowledgeItemsQuerySchema } from '../knowledges'
import { ListPaintingsQuerySchema } from '../paintings'
import { TranslateHistoryQuerySchema } from '../translate'

describe('numeric DataApi query params', () => {
  it('accepts URL-style numeric strings for pagination filters', () => {
    expect(ListFilesQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListAgentsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListAssistantsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListKnowledgeBasesQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListKnowledgeItemsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 })
    expect(ListPaintingsQuerySchema.parse({ limit: '50' })).toMatchObject({ limit: 50 })
    expect(TranslateHistoryQuerySchema.parse({ limit: '50' })).toMatchObject({ limit: 50 })
  })

  it('keeps rejecting blank, non-numeric, fractional, and oversized values', () => {
    expect(() => ListFilesQuerySchema.parse({ page: '', limit: '50' })).toThrow()
    expect(() => ListFilesQuerySchema.parse({ page: 'abc', limit: '50' })).toThrow()
    expect(() => ListFilesQuerySchema.parse({ page: '1.5', limit: '50' })).toThrow()
    expect(() => ListFilesQuerySchema.parse({ page: '1', limit: String(LIST_FILES_MAX_LIMIT + 1) })).toThrow()
  })
})
