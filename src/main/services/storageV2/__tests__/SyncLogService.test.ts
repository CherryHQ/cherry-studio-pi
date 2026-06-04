import type { Client } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  browserWindows: [
    {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn()
      }
    }
  ],
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows
  }
}))

import { IpcChannel } from '@shared/IpcChannel'

import { StorageV2SyncLogService } from '../SyncLogService'
import { getStorageV2SyncPolicy } from '../SyncPolicy'

function createClient() {
  const execute = vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === 'string' ? input : input.sql
    if (sql.includes('SELECT value FROM storage_meta')) {
      return { rows: [{ value: 'device-1' }], columns: [], columnTypes: [] }
    }
    return { rows: [], columns: [], columnTypes: [] }
  })

  return {
    client: { execute } as unknown as Client,
    execute
  }
}

describe('StorageV2SyncLogService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.getAllWindows.mockReturnValue(electronMocks.browserWindows)
  })

  it('declares sync policies for Storage v2 entities carried by WebDAV record sync', () => {
    for (const entityType of ['profile', 'model', 'blob', 'assistant_version', 'agent_version', 'sync_tombstone']) {
      expect(getStorageV2SyncPolicy(entityType)).toEqual(expect.objectContaining({ entityType }))
    }
  })

  it('rejects unknown sync entity types before writing ledger rows', async () => {
    const { client, execute } = createClient()

    await expect(
      new StorageV2SyncLogService().recordChange({
        client,
        entityType: 'unknown-entity',
        entityId: 'id-1'
      })
    ).rejects.toThrow('Unknown Storage v2 sync entity type')

    expect(execute).not.toHaveBeenCalled()
  })

  it('does not allow delete operations for append-only sync entities', async () => {
    const { client, execute } = createClient()

    await expect(
      new StorageV2SyncLogService().recordChange({
        client,
        entityType: 'task_run_log',
        entityId: 'log-1',
        operation: 'delete'
      })
    ).rejects.toThrow('append-only')

    expect(execute).not.toHaveBeenCalled()
  })

  it('writes tombstones for known delete-capable sync entities', async () => {
    const { client, execute } = createClient()

    await new StorageV2SyncLogService().recordChange({
      client,
      entityType: 'kv_record',
      entityId: 'settings:test',
      operation: 'delete',
      version: 7
    })

    const executedSql = execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(executedSql.some((sql) => sql.includes('INSERT INTO sync_changes'))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('INSERT INTO sync_tombstones'))).toBe(true)
  })

  it('broadcasts local Storage v2 changes after writing ledger rows', async () => {
    const { client } = createClient()

    await new StorageV2SyncLogService().recordChange({
      client,
      entityType: 'agent',
      entityId: 'agent-1',
      operation: 'upsert',
      version: 2
    })

    expect(electronMocks.browserWindows[0].webContents.send).toHaveBeenCalledWith(
      IpcChannel.DataSync_LocalStorageV2Changed,
      expect.objectContaining({
        entityType: 'agent',
        entityId: 'agent-1',
        operation: 'upsert',
        version: 2,
        deviceId: 'device-1',
        changedAt: expect.any(String)
      })
    )
  })
})
