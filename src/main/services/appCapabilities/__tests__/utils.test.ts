import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn()
  }
}))

import { sanitizeForAgent } from '../utils'

describe('app capability utils', () => {
  it('redacts sensitive fields while preserving ordinary values', () => {
    expect(
      sanitizeForAgent({
        apiKey: 'sk-secret',
        authorization: 'Bearer token',
        nested: {
          name: 'visible',
          cookie: ''
        }
      })
    ).toEqual({
      apiKey: '[redacted]',
      authorization: '[redacted]',
      nested: {
        name: 'visible',
        cookie: ''
      }
    })
  })

  it('serializes bigint values instead of throwing', () => {
    expect(sanitizeForAgent({ count: 42n })).toEqual({ count: '42' })
  })

  it('replaces circular references instead of throwing', () => {
    const value: Record<string, unknown> = { name: 'root' }
    value.self = value

    expect(sanitizeForAgent(value)).toEqual({
      name: 'root',
      self: '[Circular]'
    })
  })
})
