import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'

const migration0011Path = join(process.cwd(), 'migrations/sqlite-drizzle/0011_parched_tusk.sql')

describe('0011 message root schema migration', () => {
  let dir: string | undefined
  let client: Client | undefined

  afterEach(() => {
    client?.close()
    client = undefined
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
    dir = undefined
  })

  async function createPre0011Database(): Promise<Client> {
    dir = mkdtempSync(join(tmpdir(), 'cs-message-root-migration-'))
    client = createClient({ url: pathToFileURL(join(dir, 'db.sqlite')).href })

    await client.execute('PRAGMA foreign_keys = OFF')
    await client.execute(`
      CREATE TABLE user_model (
        id text PRIMARY KEY NOT NULL
      )
    `)
    await client.execute(`
      CREATE TABLE topic (
        id text PRIMARY KEY NOT NULL,
        name text DEFAULT '' NOT NULL,
        is_name_manually_edited integer DEFAULT false NOT NULL,
        assistant_id text,
        active_node_id text,
        group_id text,
        order_key text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        deleted_at integer
      )
    `)
    await client.execute(`
      CREATE TABLE message (
        id text PRIMARY KEY NOT NULL,
        parent_id text,
        topic_id text NOT NULL,
        role text NOT NULL,
        data text NOT NULL,
        searchable_text text DEFAULT '' NOT NULL,
        status text NOT NULL,
        siblings_group_id integer DEFAULT 0 NOT NULL,
        model_id text,
        model_snapshot text,
        trace_id text,
        stats text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        deleted_at integer,
        FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE cascade,
        FOREIGN KEY (model_id) REFERENCES user_model(id) ON DELETE set null,
        FOREIGN KEY (parent_id) REFERENCES message(id) ON DELETE set null,
        CONSTRAINT message_role_check CHECK(role IN ('user', 'assistant', 'system')),
        CONSTRAINT message_status_check CHECK(status IN ('pending', 'success', 'error', 'paused'))
      )
    `)

    await client.execute(`
      INSERT INTO topic (id, name, order_key, created_at, updated_at)
      VALUES ('topic-1', 'Legacy topic', 'a', 100, 200)
    `)
    await client.execute(`
      INSERT INTO message (
        id, parent_id, topic_id, role, data, searchable_text, status,
        siblings_group_id, model_id, model_snapshot, trace_id, stats,
        created_at, updated_at, deleted_at
      )
      VALUES
        ('legacy-parentless-user', NULL, 'topic-1', 'user', '{"parts":[{"type":"text","text":"hi"}]}', 'hi', 'success', 0, NULL, NULL, 'trace-a', NULL, 110, 120, NULL),
        ('legacy-child-assistant', 'legacy-parentless-user', 'topic-1', 'assistant', '{"parts":[{"type":"text","text":"hello"}]}', 'hello', 'success', 0, NULL, NULL, 'trace-b', NULL, 130, 140, NULL),
        ('legacy-parentless-system', NULL, 'topic-1', 'system', '{"parts":[{"type":"text","text":"system"}]}', 'system', 'success', 0, NULL, NULL, 'trace-c', NULL, 150, 160, NULL)
    `)

    return client
  }

  async function runMigration0011(c: Client): Promise<void> {
    const migrationSql = readFileSync(migration0011Path, 'utf8')
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)

    for (const statement of statements) {
      await c.execute(statement)
    }
  }

  it('reparents legacy parentless content messages under a generated virtual root', async () => {
    const c = await createPre0011Database()

    await runMigration0011(c)

    const violations = await c.execute(`
      SELECT id FROM message
      WHERE (role = 'root') != (parent_id IS NULL)
    `)
    expect(violations.rows).toHaveLength(0)

    const roots = await c.execute(`
      SELECT id, role, parent_id, data, created_at, updated_at
      FROM message
      WHERE topic_id = 'topic-1' AND parent_id IS NULL
    `)
    expect(roots.rows).toHaveLength(1)
    expect(roots.rows[0].role).toBe('root')
    expect(roots.rows[0].data).toBe('{"parts":[]}')
    expect(Number(roots.rows[0].created_at)).toBe(110)
    expect(Number(roots.rows[0].updated_at)).toBe(120)

    const rootId = String(roots.rows[0].id)
    const parentlessUser = await c.execute("SELECT parent_id FROM message WHERE id = 'legacy-parentless-user'")
    const parentlessSystem = await c.execute("SELECT parent_id FROM message WHERE id = 'legacy-parentless-system'")
    const child = await c.execute("SELECT parent_id FROM message WHERE id = 'legacy-child-assistant'")

    expect(parentlessUser.rows[0].parent_id).toBe(rootId)
    expect(parentlessSystem.rows[0].parent_id).toBe(rootId)
    expect(child.rows[0].parent_id).toBe('legacy-parentless-user')

    const columns = await c.execute('PRAGMA table_info(message)')
    expect(columns.rows.map((row) => row.name)).not.toContain('trace_id')
  })
})
