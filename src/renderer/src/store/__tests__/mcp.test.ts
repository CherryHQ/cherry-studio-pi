import { BuiltinMCPServerNames } from '@renderer/types'
import { createMigrate } from 'redux-persist'
import { describe, expect, it } from 'vitest'

import { builtinMCPServers, summarizeMCPServerForLog } from '../mcp'

describe('MCP filesystem defaults', () => {
  it('disables auto-approve for sensitive filesystem tools by default', () => {
    const filesystemServer = builtinMCPServers.find((server) => server.name === BuiltinMCPServerNames.filesystem)

    expect(filesystemServer?.disabledAutoApproveTools).toEqual(['write', 'edit', 'delete'])
  })

  it('summarizes MCP servers for logs without credential values or full args', () => {
    const summary = summarizeMCPServerForLog({
      id: 'server-1',
      name: 'secret-server',
      type: 'stdio',
      command: 'node',
      args: ['--api-key', 'raw-arg-secret'],
      env: {
        API_KEY: 'raw-env-secret',
        SAFE_PATH: '/tmp/workspace'
      },
      headers: {
        Authorization: 'Bearer raw-header-secret',
        'X-Debug': 'enabled'
      },
      provider: 'Manual',
      installSource: 'manual',
      isActive: true,
      isTrusted: true,
      baseUrl: 'https://example.com?token=raw-url-secret'
    })

    expect(summary).toEqual({
      id: 'server-1',
      name: 'secret-server',
      type: 'stdio',
      provider: 'Manual',
      installSource: 'manual',
      isActive: true,
      isTrusted: true,
      argsCount: 2,
      envKeys: ['API_KEY', 'SAFE_PATH'],
      headerKeys: ['Authorization', 'X-Debug'],
      hasBaseUrl: true,
      hasCommand: true
    })

    const logged = JSON.stringify(summary)
    expect(logged).not.toContain('raw-arg-secret')
    expect(logged).not.toContain('raw-env-secret')
    expect(logged).not.toContain('raw-header-secret')
    expect(logged).not.toContain('raw-url-secret')
  })

  describe('migration 202: filesystem approval backfill', () => {
    // Isolated migration function matching the logic in migrate.ts version 201
    const migrate202 = (state: any) => {
      const filesystemServer = state.mcp?.servers?.find((s: any) => s.name === '@cherry/filesystem')
      if (filesystemServer && filesystemServer.disabledAutoApproveTools === undefined) {
        filesystemServer.disabledAutoApproveTools = ['write', 'edit', 'delete']
      }
      return state
    }

    const migrate = createMigrate({ '202': migrate202 as any })

    it('backfills manual approval defaults for existing filesystem servers', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'filesystem-server',
              name: '@cherry/filesystem',
              type: 'inMemory',
              args: ['/tmp/workspace'],
              isActive: true
            }
          ]
        },
        _persist: { version: 201, rehydrated: false }
      }

      const migrated: any = await migrate(state, 202)

      expect(migrated.mcp.servers[0].disabledAutoApproveTools).toEqual(['write', 'edit', 'delete'])
    })

    it('preserves existing disabledAutoApproveTools', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'filesystem-server',
              name: '@cherry/filesystem',
              type: 'inMemory',
              args: ['/tmp/workspace'],
              isActive: true,
              disabledAutoApproveTools: ['write']
            }
          ]
        },
        _persist: { version: 201, rehydrated: false }
      }

      const migrated: any = await migrate(state, 202)

      expect(migrated.mcp.servers[0].disabledAutoApproveTools).toEqual(['write'])
    })
  })
})
