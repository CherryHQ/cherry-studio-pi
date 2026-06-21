import type { Client } from '@libsql/client'

export const STORAGE_V2_SECRET_REF_PREFIX = 'storage-v2://secret/'

const SECRET_REF_QUERIES = [
  {
    source: 'provider_credentials.secret_ref',
    column: 'secret_ref',
    sql: 'SELECT secret_ref FROM provider_credentials'
  },
  { source: 'settings.value_json', column: 'value_json', sql: 'SELECT value_json FROM settings' },
  { source: 'providers.config_json', column: 'config_json', sql: 'SELECT config_json FROM providers' },
  { source: 'models.config_json', column: 'config_json', sql: 'SELECT config_json FROM models' },
  { source: 'assistants.settings_json', column: 'settings_json', sql: 'SELECT settings_json FROM assistants' },
  {
    source: 'assistant_versions.snapshot_json',
    column: 'snapshot_json',
    sql: 'SELECT snapshot_json FROM assistant_versions'
  },
  {
    source: 'agents.accessible_paths_json',
    column: 'accessible_paths_json',
    sql: 'SELECT accessible_paths_json FROM agents'
  },
  { source: 'agents.mcps_json', column: 'mcps_json', sql: 'SELECT mcps_json FROM agents' },
  { source: 'agents.allowed_tools_json', column: 'allowed_tools_json', sql: 'SELECT allowed_tools_json FROM agents' },
  { source: 'agents.configuration_json', column: 'configuration_json', sql: 'SELECT configuration_json FROM agents' },
  {
    source: 'agent_versions.snapshot_json',
    column: 'snapshot_json',
    sql: 'SELECT snapshot_json FROM agent_versions'
  },
  {
    source: 'agent_sessions.inherited_config_json',
    column: 'inherited_config_json',
    sql: 'SELECT inherited_config_json FROM agent_sessions'
  },
  {
    source: 'agent_sessions.current_config_json',
    column: 'current_config_json',
    sql: 'SELECT current_config_json FROM agent_sessions'
  },
  { source: 'messages.token_usage_json', column: 'token_usage_json', sql: 'SELECT token_usage_json FROM messages' },
  { source: 'messages.metadata_json', column: 'metadata_json', sql: 'SELECT metadata_json FROM messages' },
  {
    source: 'message_blocks.payload_json',
    column: 'payload_json',
    sql: 'SELECT payload_json FROM message_blocks'
  },
  { source: 'files.metadata_json', column: 'metadata_json', sql: 'SELECT metadata_json FROM files' },
  { source: 'skills.tags_json', column: 'tags_json', sql: 'SELECT tags_json FROM skills' },
  { source: 'channels.config_json', column: 'config_json', sql: 'SELECT config_json FROM channels' },
  {
    source: 'channels.active_chat_ids_json',
    column: 'active_chat_ids_json',
    sql: 'SELECT active_chat_ids_json FROM channels'
  },
  {
    source: 'task_run_logs.result_json',
    column: 'result_json',
    sql: 'SELECT result_json FROM task_run_logs'
  },
  {
    source: 'knowledge_bases.settings_json',
    column: 'settings_json',
    sql: 'SELECT settings_json FROM knowledge_bases'
  },
  {
    source: 'knowledge_items.metadata_json',
    column: 'metadata_json',
    sql: 'SELECT metadata_json FROM knowledge_items'
  },
  { source: 'kv_records.value_json', column: 'value_json', sql: 'SELECT value_json FROM kv_records' },
  { source: 'sync_changes.payload_json', column: 'payload_json', sql: 'SELECT payload_json FROM sync_changes' },
  { source: 'sync_state.value_json', column: 'value_json', sql: 'SELECT value_json FROM sync_state' },
  {
    source: 'sync_conflicts.local_snapshot_json',
    column: 'local_snapshot_json',
    sql: 'SELECT local_snapshot_json FROM sync_conflicts'
  },
  {
    source: 'sync_conflicts.remote_snapshot_json',
    column: 'remote_snapshot_json',
    sql: 'SELECT remote_snapshot_json FROM sync_conflicts'
  }
] as const

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function secretRefToVaultId(secretRef: string): string | null {
  if (!secretRef.startsWith(STORAGE_V2_SECRET_REF_PREFIX)) return null

  try {
    const parts = secretRef.slice(STORAGE_V2_SECRET_REF_PREFIX.length).split('/')
    for (const part of parts) {
      decodeURIComponent(part)
    }
    return parts.join(':')
  } catch {
    return null
  }
}

function collectSecretRefs(value: unknown, refs: Set<string>, invalidRefs: Set<string>) {
  if (typeof value === 'string') {
    if (!value.startsWith(STORAGE_V2_SECRET_REF_PREFIX)) return

    const secretId = secretRefToVaultId(value)
    if (secretId) {
      refs.add(secretId)
    } else {
      invalidRefs.add(value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSecretRefs(item, refs, invalidRefs)
    }
    return
  }

  if (!value || typeof value !== 'object') return

  for (const item of Object.values(value as Record<string, unknown>)) {
    collectSecretRefs(item, refs, invalidRefs)
  }
}

export function collectStorageV2SecretRefsFromValue(value: unknown, refs: Set<string>, invalidRefs: Set<string>) {
  collectSecretRefs(parseJsonValue(value), refs, invalidRefs)
}

function isMissingSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)|SQLITE_ERROR/i.test(message) && /no such (table|column)/i.test(message)
}

export async function scanStorageV2SecretReferences(client: Client): Promise<{
  refs: Set<string>
  invalidRefs: Set<string>
  skippedSources: string[]
}> {
  const refs = new Set<string>()
  const invalidRefs = new Set<string>()
  const skippedSources: string[] = []

  for (const query of SECRET_REF_QUERIES) {
    let result: Awaited<ReturnType<Client['execute']>>
    try {
      result = await client.execute(query.sql)
    } catch (error) {
      if (isMissingSchemaError(error)) {
        skippedSources.push(query.source)
        continue
      }
      throw error
    }

    for (const row of result.rows) {
      collectStorageV2SecretRefsFromValue(row[query.column], refs, invalidRefs)
    }
  }

  return {
    refs,
    invalidRefs,
    skippedSources
  }
}
