import { describe, expect, it } from 'vitest'

import { summarizeApiServerConfigForLog } from '../logging'

describe('API server logging', () => {
  it('summarizes config without leaking the API key', () => {
    expect(
      summarizeApiServerConfigForLog({
        enabled: true,
        host: '127.0.0.1',
        port: 23333,
        apiKey: 'cs-sk-secret'
      })
    ).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 23333,
      hasApiKey: true
    })
  })

  it('keeps empty API key state debuggable', () => {
    expect(
      summarizeApiServerConfigForLog({
        enabled: false,
        host: '0.0.0.0',
        port: 3000,
        apiKey: ''
      }).hasApiKey
    ).toBe(false)
  })
})
