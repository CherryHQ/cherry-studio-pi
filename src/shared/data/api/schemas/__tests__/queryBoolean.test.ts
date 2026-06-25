import { describe, expect, it } from 'vitest'

import { QueryBooleanSchema } from '../_endpointHelpers'
import { ListMcpServersQuerySchema } from '../mcpServers'
import { BranchMessagesQuerySchema, DeleteMessageQuerySchema } from '../messages'
import { ListModelsQuerySchema } from '../models'
import { DeleteNoteQuerySchema } from '../notes'
import { ListProviderApiKeysQuerySchema, ListProvidersQuerySchema } from '../providers'
import { TranslateHistoryQuerySchema } from '../translate'

describe('QueryBooleanSchema', () => {
  it('accepts booleans and literal true/false query strings', () => {
    expect(QueryBooleanSchema.parse(true)).toBe(true)
    expect(QueryBooleanSchema.parse(false)).toBe(false)
    expect(QueryBooleanSchema.parse('true')).toBe(true)
    expect(QueryBooleanSchema.parse('false')).toBe(false)
  })

  it('does not coerce arbitrary truthy strings', () => {
    expect(() => QueryBooleanSchema.parse('0')).toThrow()
    expect(() => QueryBooleanSchema.parse('yes')).toThrow()
    expect(() => QueryBooleanSchema.parse('FALSE')).toThrow()
  })

  it('is used by DataApi boolean query filters', () => {
    expect(BranchMessagesQuerySchema.parse({ includeSiblings: 'false' }).includeSiblings).toBe(false)
    expect(DeleteMessageQuerySchema.parse({ cascade: 'false' }).cascade).toBe(false)
    expect(ListMcpServersQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false)
    expect(ListModelsQuerySchema.parse({ enabled: 'false' }).enabled).toBe(false)
    expect(DeleteNoteQuerySchema.parse({ rootPath: '/notes', path: 'a.md', recursive: 'false' }).recursive).toBe(false)
    expect(ListProvidersQuerySchema.parse({ enabled: 'false' }).enabled).toBe(false)
    expect(ListProviderApiKeysQuerySchema.parse({ enabled: 'false' }).enabled).toBe(false)
    expect(TranslateHistoryQuerySchema.parse({ star: 'false' }).star).toBe(false)
  })
})
