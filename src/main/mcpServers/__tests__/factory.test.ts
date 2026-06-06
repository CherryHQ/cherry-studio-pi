import { describe, expect, it } from 'vitest'

import { summarizeMCPFactoryEnvForLog } from '../logging'

describe('MCP server factory logging', () => {
  it('redacts sensitive environment values before logging', () => {
    expect(
      summarizeMCPFactoryEnvForLog({
        BRAVE_API_KEY: 'brave-secret',
        DIFY_KEY: 'dify-secret',
        PRIVATE_KEY: 'private-secret',
        password: 'password-secret',
        session_cookie: 'cookie-secret',
        MEMORY_FILE_PATH: '/tmp/memory.json'
      })
    ).toEqual({
      BRAVE_API_KEY: '<redacted>',
      DIFY_KEY: '<redacted>',
      PRIVATE_KEY: '<redacted>',
      password: '<redacted>',
      session_cookie: '<redacted>',
      MEMORY_FILE_PATH: '/tmp/memory.json'
    })
  })
})
