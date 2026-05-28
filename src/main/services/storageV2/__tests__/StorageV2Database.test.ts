import type { Client } from '@libsql/client'
import { describe, expect, it, vi } from 'vitest'

import { StorageV2Database } from '../StorageV2Database'

function createMockClient(events: string[]): Client {
  return {
    execute: vi.fn(async (input: string | { sql: string }) => {
      events.push(typeof input === 'string' ? input : input.sql)
      return { rows: [], columns: [], columnTypes: [] }
    })
  } as unknown as Client
}

describe('StorageV2Database.withTransaction', () => {
  it('serializes concurrent transactions on the shared client', async () => {
    const database = new StorageV2Database()
    const events: string[] = []
    const client = createMockClient(events)
    let releaseFirst!: () => void
    let first!: Promise<void>
    const firstStarted = new Promise<void>((resolve) => {
      first = database.withTransaction(client, async () => {
        events.push('first:start')
        resolve()
        await new Promise<void>((release) => {
          releaseFirst = release
        })
        events.push('first:end')
      })
    })

    await firstStarted

    const second = database.withTransaction(client, async () => {
      events.push('second:start')
    })

    await Promise.resolve()
    expect(events).not.toContain('second:start')

    const idle = database.waitForIdle().then(() => {
      events.push('idle')
    })
    await Promise.resolve()
    expect(events).not.toContain('idle')

    releaseFirst()
    await Promise.all([first, second, idle])

    expect(events).toEqual([
      'BEGIN IMMEDIATE',
      'first:start',
      'first:end',
      'COMMIT',
      'BEGIN IMMEDIATE',
      'second:start',
      'COMMIT',
      'idle'
    ])
  })

  it('rolls back a failed transaction before running the next queued transaction', async () => {
    const database = new StorageV2Database()
    const events: string[] = []
    const client = createMockClient(events)

    await expect(
      database.withTransaction(client, async () => {
        events.push('first:start')
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    await database.withTransaction(client, async () => {
      events.push('second:start')
    })

    expect(events).toEqual(['BEGIN IMMEDIATE', 'first:start', 'ROLLBACK', 'BEGIN IMMEDIATE', 'second:start', 'COMMIT'])
  })
})
