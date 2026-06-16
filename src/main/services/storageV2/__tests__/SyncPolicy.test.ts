import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  assertStorageV2SyncPolicy,
  listStorageV2SyncPolicies,
  STORAGE_V2_SYNC_CONFLICT_UI_FIELDS,
  STORAGE_V2_SYNC_DEVICE_ID_META_KEY,
  STORAGE_V2_SYNC_POLICY_VERSION
} from '../SyncPolicy'

const LEDGER_ENTITY_TYPES = [
  'agent',
  'agent_session',
  'agent_skill',
  'assistant',
  'channel',
  'channel_task_subscription',
  'conversation',
  'file',
  'knowledge_base',
  'knowledge_item',
  'kv_record',
  'message',
  'message_block',
  'provider',
  'provider_credential',
  'scheduled_task',
  'settings',
  'skill',
  'task_run_log'
]

const WEB_DAV_RECORD_SYNC_SUPPORT_ENTITY_TYPES = [
  'agent_version',
  'assistant_version',
  'blob',
  'model',
  'profile',
  'sync_tombstone'
]

const LOCAL_ONLY_STORAGE_V2_TABLES = [
  'devices',
  'migration_runs',
  'storage_meta',
  'sync_changes',
  'sync_conflicts',
  'sync_state'
]

function readStorageV2DatabaseSchemaTables() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const databaseSource = fs.readFileSync(path.join(currentDir, '../StorageV2Database.ts'), 'utf-8')
  const tableMatches = databaseSource.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)

  return Array.from(tableMatches, (match) => match[1]).sort()
}

describe('Storage v2 sync policy', () => {
  it('defines stable device and conflict metadata for future account sync', () => {
    expect(STORAGE_V2_SYNC_POLICY_VERSION).toBe(1)
    expect(STORAGE_V2_SYNC_DEVICE_ID_META_KEY).toBe('device_id')
    expect(STORAGE_V2_SYNC_CONFLICT_UI_FIELDS).toEqual([
      'entityType',
      'entityId',
      'localSnapshot',
      'remoteSnapshot',
      'baseVersion',
      'localDeviceId',
      'remoteDeviceId',
      'createdAt',
      'resolvedAt'
    ])
  })

  it('covers every ledger entity and every WebDAV record sync support entity', () => {
    const policies = listStorageV2SyncPolicies()
    const entityTypes = policies.map((policy) => policy.entityType).sort()

    expect(entityTypes).toEqual([...LEDGER_ENTITY_TYPES, ...WEB_DAV_RECORD_SYNC_SUPPORT_ENTITY_TYPES].sort())
    expect(new Set(entityTypes).size).toBe(entityTypes.length)

    for (const entityType of LEDGER_ENTITY_TYPES) {
      expect(assertStorageV2SyncPolicy(entityType), entityType).toBeTruthy()
    }
    for (const entityType of WEB_DAV_RECORD_SYNC_SUPPORT_ENTITY_TYPES) {
      expect(assertStorageV2SyncPolicy(entityType), entityType).toBeTruthy()
    }
  })

  it('requires every Storage v2 table to be explicitly synced or intentionally local-only', () => {
    const schemaTables = readStorageV2DatabaseSchemaTables()
    const syncedTables = listStorageV2SyncPolicies().map((policy) => policy.table)

    expect(new Set(schemaTables).size).toBe(schemaTables.length)
    expect(new Set(syncedTables).size).toBe(syncedTables.length)
    expect(schemaTables).toEqual([...syncedTables, ...LOCAL_ONLY_STORAGE_V2_TABLES].sort())
  })

  it('pins version, updated_at, and deleted_at semantics for mutable rows', () => {
    for (const policy of listStorageV2SyncPolicies()) {
      if (policy.versioned && policy.deletionSemantics !== 'append-only') {
        expect(policy.updatedAtColumn, policy.entityType).toBeTruthy()
      }

      if (policy.deletionSemantics === 'soft-delete-with-tombstone') {
        expect(policy.deletedAtColumn, policy.entityType).toBe('deleted_at')
        expect(policy.clearSemantics, policy.entityType).toMatch(/deleted-at-tombstone|explicit-cleared-marker/)
      }
    }
  })

  it('keeps sensitive values out of cloud sync policies', () => {
    expect(assertStorageV2SyncPolicy('provider')).toMatchObject({
      mergeStrategy: 'last-write-wins-with-secret-ref',
      secretMode: 'secret-ref-only'
    })
    expect(assertStorageV2SyncPolicy('provider_credential')).toMatchObject({
      mergeStrategy: 'last-write-wins-with-secret-ref',
      secretMode: 'secret-ref-only',
      clearSemantics: 'deleted-at-tombstone'
    })
    expect(assertStorageV2SyncPolicy('channel')).toMatchObject({
      mergeStrategy: 'last-write-wins-with-secret-ref',
      secretMode: 'secret-ref-only'
    })
    expect(assertStorageV2SyncPolicy('settings')).toMatchObject({
      secretMode: 'secret-ref-only',
      clearSemantics: 'explicit-cleared-marker'
    })
    expect(assertStorageV2SyncPolicy('kv_record')).toMatchObject({
      secretMode: 'secret-ref-only',
      clearSemantics: 'explicit-cleared-marker'
    })
  })

  it('declares merge strategies for the major product domains', () => {
    expect(assertStorageV2SyncPolicy('assistant').mergeStrategy).toBe('last-write-wins')
    expect(assertStorageV2SyncPolicy('conversation').mergeStrategy).toBe('parent-child-ordered')
    expect(assertStorageV2SyncPolicy('message').mergeStrategy).toBe('parent-child-ordered')
    expect(assertStorageV2SyncPolicy('agent').mergeStrategy).toBe('last-write-wins')
    expect(assertStorageV2SyncPolicy('file').mergeStrategy).toBe('content-addressed')
    expect(assertStorageV2SyncPolicy('task_run_log').mergeStrategy).toBe('append-only')
    expect(assertStorageV2SyncPolicy('task_run_log').syncIdentityColumns).toEqual(['task_id', 'run_at'])
  })
})
