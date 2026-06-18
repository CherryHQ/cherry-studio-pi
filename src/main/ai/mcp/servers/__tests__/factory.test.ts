import { describe, expect, it } from 'vitest'

import { isSensitiveMcpDiagnosticKey, summarizeMCPFactoryEnvForLog } from '../logging'

describe('MCP server factory logging', () => {
  it('redacts sensitive environment values before logging', () => {
    expect(
      summarizeMCPFactoryEnvForLog({
        BRAVE_API_KEY: 'brave-secret',
        DIFY_KEY: 'dify-secret',
        PRIVATE_KEY: 'private-secret',
        ACCESS_TOKEN: 'token-secret',
        password: 'password-secret',
        session_cookie: 'cookie-secret',
        COMPASS_MODE: 'north',
        BYPASS_PROXY: 'localhost',
        TOKEN_COUNT: '42',
        MEMORY_FILE_PATH: '/tmp/memory.json'
      })
    ).toEqual({
      BRAVE_API_KEY: '<redacted>',
      DIFY_KEY: '<redacted>',
      PRIVATE_KEY: '<redacted>',
      ACCESS_TOKEN: '<redacted>',
      password: '<redacted>',
      session_cookie: '<redacted>',
      COMPASS_MODE: 'north',
      BYPASS_PROXY: 'localhost',
      TOKEN_COUNT: '42',
      MEMORY_FILE_PATH: '/tmp/memory.json'
    })
  })

  it('detects sensitive MCP diagnostic keys without matching ordinary pass words', () => {
    expect(isSensitiveMcpDiagnosticKey('webdavPass')).toBe(true)
    expect(isSensitiveMcpDiagnosticKey('DIFY_KEY')).toBe(true)
    expect(isSensitiveMcpDiagnosticKey('apiToken')).toBe(true)
    expect(isSensitiveMcpDiagnosticKey('session_cookie')).toBe(true)
    expect(isSensitiveMcpDiagnosticKey('compass')).toBe(false)
    expect(isSensitiveMcpDiagnosticKey('bypassReason')).toBe(false)
    expect(isSensitiveMcpDiagnosticKey('passage')).toBe(false)
    expect(isSensitiveMcpDiagnosticKey('tokenCount')).toBe(false)
    expect(isSensitiveMcpDiagnosticKey('completionTokens')).toBe(false)
  })
})
