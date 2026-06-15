import { describe, expect, it } from 'vitest'

import { buildMcpClientInfo, getMcpAppHeader } from '../clientIdentity'

describe('MCP client identity', () => {
  it('uses the Cherry Studio Pi product name for protocol clients and app headers', () => {
    expect(buildMcpClientInfo('9.8.7')).toEqual({ name: 'Cherry Studio Pi', version: '9.8.7' })
    expect(getMcpAppHeader()).toBe('Cherry Studio Pi')
  })
})
