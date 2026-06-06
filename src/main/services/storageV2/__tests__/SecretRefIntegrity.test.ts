import type { Client } from '@libsql/client'
import { describe, expect, it, vi } from 'vitest'

import { scanStorageV2SecretReferences } from '../SecretRefIntegrity'

function createMockClient(): Client {
  return {
    execute: vi.fn(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('provider_credentials')) {
        return {
          rows: [{ secret_ref: 'storage-v2://secret/provider/provider%201/apiKey' }],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM settings')) {
        return {
          rows: [
            {
              value_json: JSON.stringify({
                nested: {
                  secretRef: 'storage-v2://secret/settings/s3/secretAccessKey'
                },
                invalidSecretRef: 'storage-v2://secret/%'
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM models')) {
        return {
          rows: [
            {
              config_json: JSON.stringify({
                fallbackCredential: 'storage-v2://secret/model/model-1/fallback'
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM assistant_versions')) {
        return {
          rows: [
            {
              snapshot_json: JSON.stringify({
                model: {
                  apiKeySecretRef: 'storage-v2://secret/assistant-version/av-1/apiKey'
                }
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [
            {
              snapshot_json: JSON.stringify({
                tools: [{ credentialRef: 'storage-v2://secret/agent-version/agv-1/tool-token' }]
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM agents')) {
        return {
          rows: [
            {
              accessible_paths_json: JSON.stringify([]),
              mcps_json: JSON.stringify({
                serverCredentialRef: 'storage-v2://secret/agent/agent-1/mcp-server'
              }),
              allowed_tools_json: JSON.stringify([]),
              configuration_json: JSON.stringify({
                toolCredentialRef: 'storage-v2://secret/agent/agent-1/tool'
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM agent_sessions')) {
        return {
          rows: [
            {
              inherited_config_json: JSON.stringify({
                inheritedSecretRef: 'storage-v2://secret/agent-session/session-1/inherited'
              }),
              current_config_json: JSON.stringify({
                currentSecretRef: 'storage-v2://secret/agent-session/session-1/current'
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM messages')) {
        return {
          rows: [
            {
              metadata_json: JSON.stringify({
                providerTraceSecretRef: 'storage-v2://secret/message/message-1/provider-trace'
              }),
              token_usage_json: JSON.stringify({})
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM message_blocks')) {
        return {
          rows: [
            {
              payload_json: JSON.stringify({
                toolResult: {
                  secretRef: 'storage-v2://secret/message-block/block-1/tool-result'
                }
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM files')) {
        return {
          rows: [
            {
              metadata_json: JSON.stringify({
                externalSecretRef: 'storage-v2://secret/file/file-1/external'
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM sync_changes')) {
        return {
          rows: [
            {
              payload_json: JSON.stringify({
                before: {
                  secretRef: 'storage-v2://secret/sync-change/change-1/before'
                }
              })
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM sync_conflicts')) {
        throw new Error('SQLITE_ERROR: no such table: sync_conflicts')
      }

      return { rows: [], columns: [], columnTypes: [] }
    })
  } as unknown as Client
}

describe('scanStorageV2SecretReferences', () => {
  it('collects nested secret refs and tracks invalid refs', async () => {
    const result = await scanStorageV2SecretReferences(createMockClient())

    expect(result.refs).toEqual(
      new Set([
        'provider:provider%201:apiKey',
        'settings:s3:secretAccessKey',
        'model:model-1:fallback',
        'assistant-version:av-1:apiKey',
        'agent-version:agv-1:tool-token',
        'agent:agent-1:mcp-server',
        'agent:agent-1:tool',
        'agent-session:session-1:inherited',
        'agent-session:session-1:current',
        'message:message-1:provider-trace',
        'message-block:block-1:tool-result',
        'file:file-1:external',
        'sync-change:change-1:before'
      ])
    )
    expect(result.invalidRefs).toEqual(new Set(['storage-v2://secret/%']))
    expect(result.skippedSources).toEqual(['sync_conflicts.local_snapshot_json', 'sync_conflicts.remote_snapshot_json'])
  })
})
