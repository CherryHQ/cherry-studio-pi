import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn()
  }
}))

import { isAllowedAppRoute, normalizeAppRoute, sanitizeForAgent } from '../utils'

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

  it('preserves repeated non-circular object references', () => {
    const shared = { value: 'same' }

    expect(sanitizeForAgent({ first: shared, second: shared })).toEqual({
      first: { value: 'same' },
      second: { value: 'same' }
    })
  })

  it('returns JSON-safe values for dates and unsupported values', () => {
    expect(
      sanitizeForAgent({
        updatedAt: new Date('2026-06-06T00:00:00.000Z'),
        missing: undefined,
        list: [undefined, () => 'skip']
      })
    ).toEqual({
      updatedAt: '2026-06-06T00:00:00.000Z',
      list: [null, null]
    })
  })

  it('bounds large values before returning them to agents', () => {
    const sanitized = sanitizeForAgent({
      text: 'x'.repeat(10_000),
      items: Array.from({ length: 205 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`key${index}`, index]))
    }) as any

    expect(sanitized.text).toHaveLength(8_025)
    expect(sanitized.text).toContain('[truncated 2000 chars]')
    expect(sanitized.text).not.toContain('x'.repeat(9_000))
    expect(sanitized.items).toHaveLength(201)
    expect(sanitized.items.at(-1)).toBe('[...truncated 5 items...]')
    expect(Object.keys(sanitized.object)).toHaveLength(201)
    expect(sanitized.object.__truncatedKeys).toBe(5)
  })

  it('bounds deeply nested objects before returning them to agents', () => {
    const root: Record<string, unknown> = {}
    let current = root
    for (let index = 0; index < 10; index += 1) {
      const next: Record<string, unknown> = {}
      current.child = next
      current = next
    }

    expect(JSON.stringify(sanitizeForAgent(root))).toContain('[Object truncated]')
  })

  it('normalizes and validates application routes', () => {
    expect(normalizeAppRoute('settings/data')).toBe('/settings/data')
    expect(isAllowedAppRoute('/settings/data')).toBe(true)
    expect(isAllowedAppRoute('/agents/session-1')).toBe(true)
    expect(isAllowedAppRoute('/settings-malicious')).toBe(false)
    expect(isAllowedAppRoute('https://example.com')).toBe(false)
  })
})
