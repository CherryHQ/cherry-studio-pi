import { describe, expect, it } from 'vitest'

import { getProviderSyncErrorDetails, getProviderSyncToastMessage, McpProviderRequestTimeoutError } from '../request'

const t = (key: string, options?: Record<string, unknown>) =>
  typeof options?.defaultValue === 'string' ? options.defaultValue : key

describe('MCP provider request error formatting', () => {
  it('preserves ordinary Error messages', () => {
    expect(getProviderSyncErrorDetails(new Error('network unavailable'))).toBe('network unavailable')
  })

  it('preserves string errors', () => {
    expect(getProviderSyncErrorDetails('401 Unauthorized')).toBe('401 Unauthorized')
  })

  it('extracts nested IPC error messages', () => {
    expect(
      getProviderSyncErrorDetails({
        error: {
          message: 'Invalid response: 503 Service Unavailable'
        }
      })
    ).toBe('Invalid response: 503 Service Unavailable')
  })

  it('serializes plain error objects without message fields', () => {
    expect(getProviderSyncErrorDetails({ code: 'ECONNRESET', status: 502 })).toBe('{"code":"ECONNRESET","status":502}')
  })

  it('uses a clear fallback for circular objects', () => {
    const error: { self?: unknown } = {}
    error.self = error

    expect(getProviderSyncErrorDetails(error)).toBe('Unknown error')
  })

  it('uses localized timeout guidance without repeating timeout details', () => {
    const error = new McpProviderRequestTimeoutError(15_000)

    expect(getProviderSyncToastMessage(t, error)).toBe(
      'Sync timed out. Please check your network connection and try again.'
    )
  })

  it('combines generic sync errors with extracted details', () => {
    expect(getProviderSyncToastMessage(t, { error: { message: '403 Forbidden' } })).toBe(
      'settings.mcp.sync.error: 403 Forbidden'
    )
  })
})
