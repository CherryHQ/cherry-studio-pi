import { describe, expect, it, vi } from 'vitest'

import { getMcpConfigSampleFromReadme } from '../mcp'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

describe('mcp utils', () => {
  describe('getMcpConfigSampleFromReadme', () => {
    it('returns the first npx config when a mcpServers object contains multiple servers', () => {
      const readme = `
        {
          "mcpServers": {
            "local": { "command": "node", "args": ["server.js"] },
            "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }
          }
        }
      `

      expect(getMcpConfigSampleFromReadme(readme)).toEqual({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem']
      })
    })

    it('returns null when no npx config is present', () => {
      const readme = `
        {
          "mcpServers": {
            "local": { "command": "node", "args": ["server.js"] }
          }
        }
      `

      expect(getMcpConfigSampleFromReadme(readme)).toBeNull()
    })
  })
})
