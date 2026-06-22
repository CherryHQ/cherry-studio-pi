import { describe, expect, it } from 'vitest'

import { extractErrorMessage, getErrorMessage } from '../errorMessage'

describe('main errorMessage utilities', () => {
  it('extracts native error messages and nested causes', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom')
    expect(extractErrorMessage(new Error('', { cause: { code: 'SQLITE_BUSY' } }))).toBe('SQLITE_BUSY')
  })

  it('extracts structured response status details', () => {
    expect(
      extractErrorMessage({
        response: {
          status: '503',
          statusText: 'Service Unavailable'
        }
      })
    ).toBe('503 Service Unavailable')
  })

  it('falls back safely for circular objects', () => {
    const circular: Record<string, unknown> = {}
    circular.cause = circular

    expect(getErrorMessage(circular, 'fallback')).toBe('fallback')
  })
})
