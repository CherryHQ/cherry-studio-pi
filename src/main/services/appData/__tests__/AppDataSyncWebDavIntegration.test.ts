import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { createClient, type InValue } from '@libsql/client'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storageV2Database } from '../../storageV2/StorageV2Database'
import { AppDataDatabase, getAppDataDatabase } from '../AppDataDatabase'
import { AppDataSyncService } from '../AppDataSyncService'

vi.mock('@main/services/BackupManager', () => ({
  default: vi.fn()
}))

vi.unmock('node:fs')
vi.unmock('node:fs/promises')
vi.unmock('node:http')
vi.unmock('node:path')
vi.unmock('node:stream/promises')

type WebDavTestServer = {
  url: string
  root: string
  setDenyWrites: (value: boolean) => void
  close: () => Promise<void>
}

type TestInstance = {
  userData: string
  dataRoot: string
}

type ComprehensiveStorageFixture = {
  blobChecksum: string
  blobPayload: string
  blobStoragePath: string
}

type WebDavServerState = {
  denyWrites: boolean
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeRequestPath(requestUrl = '/') {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const decoded = decodeURIComponent(url.pathname)
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'))
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function resolveWebDavPath(root: string, requestUrl = '/') {
  const normalized = normalizeRequestPath(requestUrl)
  if (normalized === '..' || normalized.startsWith('/../')) {
    throw new Error('Invalid WebDAV path')
  }
  return path.join(root, normalized.slice(1))
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

function responseHref(filePath: string) {
  return `/${filePath.split(path.sep).filter(Boolean).map(encodeURIComponent).join('/')}`
}

async function propfind(root: string, req: IncomingMessage, res: ServerResponse) {
  const targetPath = resolveWebDavPath(root, req.url)
  if (!(await pathExists(targetPath))) {
    res.writeHead(404)
    res.end()
    return
  }

  const stat = await fsp.stat(targetPath)
  const requestPath = normalizeRequestPath(req.url)
  const depth = req.headers.depth === '1' ? 1 : 0
  const entries: Array<{ absolutePath: string; href: string; stat: fs.Stats }> = [
    { absolutePath: targetPath, href: requestPath, stat }
  ]

  if (stat.isDirectory() && depth === 1) {
    for (const name of await fsp.readdir(targetPath)) {
      const childPath = path.join(targetPath, name)
      entries.push({
        absolutePath: childPath,
        href: path.posix.join(requestPath, responseHref(name)),
        stat: await fsp.stat(childPath)
      })
    }
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${entries
  .map(
    (entry) => `<d:response>
  <d:href>${xmlEscape(entry.href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:resourcetype>${entry.stat.isDirectory() ? '<d:collection/>' : ''}</d:resourcetype>
      <d:getcontentlength>${entry.stat.isFile() ? entry.stat.size : 0}</d:getcontentlength>
      <d:getlastmodified>${entry.stat.mtime.toUTCString()}</d:getlastmodified>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`
  )
  .join('\n')}
</d:multistatus>`

  res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' })
  res.end(body)
}

async function handleWebDavRequest(root: string, state: WebDavServerState, req: IncomingMessage, res: ServerResponse) {
  try {
    const targetPath = resolveWebDavPath(root, req.url)
    const isWriteMethod = req.method === 'MKCOL' || req.method === 'PUT' || req.method === 'DELETE'

    if (state.denyWrites && isWriteMethod) {
      res.writeHead(403)
      res.end()
      return
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200, { allow: 'OPTIONS, GET, HEAD, PROPFIND, MKCOL, PUT, DELETE' })
      res.end()
      return
    }

    if (req.method === 'PROPFIND') {
      await propfind(root, req, res)
      return
    }

    if (req.method === 'MKCOL') {
      if (await pathExists(targetPath)) {
        res.writeHead(405)
        res.end()
        return
      }
      await fsp.mkdir(targetPath, { recursive: true })
      res.writeHead(201)
      res.end()
      return
    }

    if (req.method === 'PUT') {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true })
      await pipeline(req, fs.createWriteStream(targetPath))
      res.writeHead(201)
      res.end()
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!(await pathExists(targetPath))) {
        res.writeHead(404)
        res.end()
        return
      }
      const stat = await fsp.stat(targetPath)
      res.writeHead(200, { 'content-length': stat.isFile() ? stat.size : 0 })
      if (req.method === 'HEAD' || !stat.isFile()) {
        res.end()
        return
      }
      fs.createReadStream(targetPath).pipe(res)
      return
    }

    if (req.method === 'DELETE') {
      await fsp.rm(targetPath, { recursive: true, force: true })
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(405)
    res.end()
  } catch (error) {
    res.writeHead(500)
    res.end(error instanceof Error ? error.message : String(error))
  }
}

async function startWebDavServer(
  root: string,
  state: WebDavServerState = { denyWrites: false }
): Promise<WebDavTestServer> {
  await fsp.mkdir(root, { recursive: true })
  const server = createServer((req, res) => {
    void handleWebDavRequest(root, state, req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start local WebDAV server')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    root,
    setDenyWrites: (value: boolean) => {
      state.denyWrites = value
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()))
      })
  }
}

function makeInstance(root: string, name: string): TestInstance {
  return {
    userData: path.join(root, name),
    dataRoot: path.join(root, name, 'Data')
  }
}

async function switchInstance(instance: TestInstance, homePath: string) {
  await AppDataDatabase.close()
  storageV2Database.close()
  process.env.CHERRY_STUDIO_STORAGE_V2_ROOT = instance.dataRoot
  ;(app as unknown as { getAppPath?: ReturnType<typeof vi.fn> }).getAppPath ??= vi.fn()
  vi.mocked(app.getAppPath).mockReturnValue(process.cwd())
  vi.mocked(app.getPath).mockImplementation((key: string) => {
    switch (key) {
      case 'userData':
        return instance.userData
      case 'home':
        return homePath
      case 'appData':
        return path.join(homePath, 'Library', 'Application Support')
      case 'temp':
        return path.join(homePath, 'tmp')
      default:
        return path.join(homePath, key)
    }
  })
}

async function seedInstanceData(input: {
  appRecordValue: unknown
  appRecordUpdatedAt: number
  storageSettingValue: unknown
  storageSettingUpdatedAt: string
}) {
  const appDb = await getAppDataDatabase()
  await appDb.setRecord('settings', 'sync.integration.theme', input.appRecordValue, input.appRecordUpdatedAt)

  const storageClient = await storageV2Database.getClient()
  await storageClient.execute({
    sql: `
      INSERT INTO settings (key, value_json, scope, updated_at, version, deleted_at)
      VALUES (?, ?, 'app', ?, 1, NULL)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        version = settings.version + 1,
        deleted_at = NULL
    `,
    args: [
      'settings.sync.integration.storage',
      JSON.stringify(input.storageSettingValue),
      input.storageSettingUpdatedAt
    ]
  })
}

async function seedComprehensiveStorageV2Data(instance: TestInstance): Promise<ComprehensiveStorageFixture> {
  const client = await storageV2Database.getClient()
  const createdAt = '2026-05-29T13:00:00.000Z'
  const updatedAt = '2026-05-29T13:10:00.000Z'
  const blobStoragePath = 'Blobs/comprehensive-sync-fixture.txt'
  const blobPayload = [
    'Cherry Studio Pi comprehensive sync fixture',
    'provider/model/assistant/agent/knowledge/conversation/settings'
  ].join('\n')
  const blobBytes = Buffer.from(blobPayload, 'utf8')
  const blobChecksum = createHash('sha256').update(blobBytes).digest('hex')
  const blobPath = path.join(instance.dataRoot, blobStoragePath)

  await fsp.mkdir(path.dirname(blobPath), { recursive: true })
  await fsp.writeFile(blobPath, blobBytes)

  const execute = (sql: string, args: InValue[] = []) => client.execute({ sql, args })
  const json = (value: unknown) => JSON.stringify(value)

  await execute(
    `
      INSERT INTO profiles (id, name, avatar_blob_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ['profile-sync-full', '同步测试用户', 'blob-sync-full-doc', createdAt, updatedAt]
  )
  await execute(
    `
      INSERT INTO providers (
        id, type, name, api_host, enabled, sort_order, config_json,
        created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, 1, 7, ?, ?, ?, NULL, 3)
    `,
    [
      'provider-sync-full-openai',
      'openai-compatible',
      '同步测试模型服务',
      'https://sync.example.test/v1',
      json({ apiKeySecretRef: 'storage-v2://secret/provider-sync-full-openai/apiKey', timeoutMs: 30000 }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO models (
        id, provider_id, name, group_name, capabilities_json, config_json,
        enabled, sort_order, created_at, updated_at, deleted_at
      )
      VALUES
        (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, NULL),
        (?, ?, ?, ?, ?, ?, 1, 2, ?, ?, NULL)
    `,
    [
      'model-sync-full-chat',
      'provider-sync-full-openai',
      'sync-gpt-4.1',
      'chat',
      json(['chat', 'vision', 'tool_use']),
      json({ contextWindow: 128000, temperature: 0.2 }),
      createdAt,
      updatedAt,
      'model-sync-full-embedding',
      'provider-sync-full-openai',
      'sync-embedding-large',
      'embedding',
      json(['embedding']),
      json({ dimensions: 3072 }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO blobs (id, algorithm, size, mime, ext, storage_path, checksum, created_at, ref_count)
      VALUES (?, 'sha256', ?, 'text/plain', '.txt', ?, ?, ?, 4)
    `,
    ['blob-sync-full-doc', blobBytes.byteLength, blobStoragePath, blobChecksum, createdAt]
  )
  await execute(
    `
      INSERT INTO assistants (
        id, name, description, prompt, model_id, settings_json, avatar_blob_id,
        tags_json, sort_order, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 4, ?, ?, NULL, 5)
    `,
    [
      'assistant-sync-full',
      '同步测试助手',
      '覆盖助手提示词、模型和偏好的同步 fixture',
      '你是一个用于验证多端同步的助手。',
      'model-sync-full-chat',
      json({ temperature: 0.35, maxTokens: 2048, preferredLanguage: 'zh-CN' }),
      'blob-sync-full-doc',
      json(['sync', 'assistant']),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO assistant_versions (id, assistant_id, snapshot_json, created_at, created_by_device_id)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      'assistant-version-sync-full',
      'assistant-sync-full',
      json({ name: '同步测试助手', prompt: '你是一个用于验证多端同步的助手。' }),
      updatedAt,
      'device-a'
    ]
  )
  await execute(
    `
      INSERT INTO agents (
        id, type, name, description, instructions, model_id, plan_model_id, small_model_id,
        accessible_paths_json, mcps_json, allowed_tools_json, configuration_json, avatar_blob_id,
        sort_order, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?, NULL, 6)
    `,
    [
      'agent-sync-full',
      'pi',
      '同步测试 Agent',
      '覆盖 agent 配置、权限、工具和 skill 关联',
      '读取用户意图，必要时调用设置、知识库和绘图工具。',
      'model-sync-full-chat',
      'model-sync-full-chat',
      'model-sync-full-chat',
      json(['/tmp/cherry-studio-pi-sync-fixture']),
      json([{ id: 'mcp-sync-settings', name: 'Settings MCP' }]),
      json(['settings.read', 'settings.write', 'knowledge.search', 'image.generate']),
      json({ permissionMode: 'soul', autoApprove: false, maxToolCalls: 12 }),
      'blob-sync-full-doc',
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO agent_versions (id, agent_id, snapshot_json, created_at, created_by_device_id)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      'agent-version-sync-full',
      'agent-sync-full',
      json({ name: '同步测试 Agent', permissionMode: 'soul' }),
      updatedAt,
      'device-a'
    ]
  )
  await execute(
    `
      INSERT INTO skills (
        id, name, description, folder_name, source, source_url, namespace, author, tags_json,
        content_hash, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 2)
    `,
    [
      'skill-sync-full',
      '同步测试 Skill',
      '用于验证 agent skill 关联同步',
      'sync-fixture-skill',
      'local',
      '@sync/fixture',
      'Cherry Studio Pi',
      json(['sync', 'skill']),
      createHash('sha256').update('sync-fixture-skill').digest('hex'),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO agent_skills (agent_id, skill_id, enabled, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `,
    ['agent-sync-full', 'skill-sync-full', createdAt, updatedAt]
  )
  await execute(
    `
      INSERT INTO agent_sessions (
        id, agent_id, name, inherited_config_json, current_config_json,
        sort_order, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, 4)
    `,
    [
      'agent-session-sync-full',
      'agent-sync-full',
      '同步测试任务会话',
      json({ modelId: 'model-sync-full-chat', permissionMode: 'soul' }),
      json({ workingDirectory: '/tmp/cherry-studio-pi-sync-fixture', status: 'ready' }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO scheduled_tasks (
        id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes,
        next_run, last_run, last_result, status, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, 5, ?, ?, ?, 'active', ?, ?, NULL, 2)
    `,
    [
      'task-sync-full',
      'agent-sync-full',
      '同步测试定时任务',
      '每天检查同步 fixture 是否存在。',
      'cron',
      '0 9 * * *',
      '2026-05-30T01:00:00.000Z',
      '2026-05-29T01:00:00.000Z',
      json({ ok: true, checked: 'comprehensive-fixture' }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO task_run_logs (id, task_id, session_id, run_at, duration_ms, status, result_json, error, version)
      VALUES (101, ?, ?, ?, 1234, 'success', ?, NULL, 1)
    `,
    ['task-sync-full', 'agent-session-sync-full', updatedAt, json({ output: 'fixture synced' })]
  )
  await execute(
    `
      INSERT INTO channels (
        id, type, name, agent_id, session_id, config_json, is_active, active_chat_ids_json,
        permission_mode, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, 2)
    `,
    [
      'channel-sync-full',
      'webhook',
      '同步测试频道',
      'agent-sync-full',
      'agent-session-sync-full',
      json({ endpointSecretRef: 'storage-v2://secret/channel-sync-full/webhook' }),
      json(['chat-sync-full']),
      'soul',
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO channel_task_subscriptions (channel_id, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `,
    ['channel-sync-full', 'task-sync-full', createdAt, updatedAt]
  )
  await execute(
    `
      INSERT INTO conversations (
        id, kind, owner_type, owner_id, session_id, title, pinned, archived,
        sort_order, created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 2, ?, ?, NULL, 3)
    `,
    [
      'conversation-sync-full',
      'agent_session',
      'agent',
      'agent-sync-full',
      'agent-session-sync-full',
      '同步测试对话',
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO messages (
        id, conversation_id, role, status, parent_id, request_id, model_id, provider_id,
        token_usage_json, metadata_json, created_at, updated_at, deleted_at, version
      )
      VALUES
        (?, ?, 'user', 'complete', NULL, ?, NULL, NULL, ?, ?, ?, ?, NULL, 1),
        (?, ?, 'assistant', 'complete', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 2)
    `,
    [
      'message-sync-user',
      'conversation-sync-full',
      'request-sync-full-1',
      json({ input: 12, output: 0 }),
      json({ source: 'manual', fixture: true }),
      createdAt,
      createdAt,
      'message-sync-assistant',
      'conversation-sync-full',
      'message-sync-user',
      'request-sync-full-1',
      'model-sync-full-chat',
      'provider-sync-full-openai',
      json({ input: 12, output: 48 }),
      json({ finishReason: 'stop', fixture: true }),
      updatedAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO message_blocks (
        id, message_id, type, ordinal, text, payload_json, blob_id,
        created_at, updated_at, deleted_at, version
      )
      VALUES
        (?, ?, 'text', 0, ?, NULL, NULL, ?, ?, NULL, 1),
        (?, ?, 'text', 0, ?, ?, NULL, ?, ?, NULL, 1),
        (?, ?, 'file', 1, NULL, ?, ?, ?, ?, NULL, 1)
    `,
    [
      'message-block-sync-user-text',
      'message-sync-user',
      '请验证同步 fixture 是否完整。',
      createdAt,
      createdAt,
      'message-block-sync-assistant-text',
      'message-sync-assistant',
      '已检查模型、助手、Agent、知识库和设置。',
      json({ citations: ['knowledge-item-sync-full'] }),
      updatedAt,
      updatedAt,
      'message-block-sync-assistant-file',
      'message-sync-assistant',
      json({ fileId: 'file-sync-full-doc', displayName: 'comprehensive-sync-fixture.txt' }),
      'blob-sync-full-doc',
      updatedAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO files (
        id, blob_id, original_name, display_name, source, metadata_json,
        created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 2)
    `,
    [
      'file-sync-full-doc',
      'blob-sync-full-doc',
      'comprehensive-sync-fixture.txt',
      '综合同步测试文档.txt',
      'knowledge',
      json({ bytes: blobBytes.byteLength, checksum: blobChecksum }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO knowledge_bases (
        id, name, model_id, embedding_model_id, rerank_model_id, settings_json,
        created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 2)
    `,
    [
      'knowledge-base-sync-full',
      '同步测试知识库',
      'model-sync-full-chat',
      'model-sync-full-embedding',
      json({ chunkSize: 512, retrievalTopK: 6, language: 'zh-CN' }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO knowledge_items (
        id, knowledge_base_id, source_type, source_uri, file_id, content_hash, status, metadata_json,
        created_at, updated_at, deleted_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 2)
    `,
    [
      'knowledge-item-sync-full',
      'knowledge-base-sync-full',
      'file',
      'file://comprehensive-sync-fixture.txt',
      'file-sync-full-doc',
      blobChecksum,
      'indexed',
      json({ title: '综合同步测试文档', tokens: 128 }),
      createdAt,
      updatedAt
    ]
  )
  await execute(
    `
      INSERT INTO kv_records (scope, key, value_json, source, updated_at, deleted_at, version)
      VALUES (?, ?, ?, ?, ?, NULL, 2)
    `,
    ['ui', 'sync.fixture.workspace', json({ layout: 'compact', sidebar: 'agents' }), 'integration-test', updatedAt]
  )
  await execute(
    `
      INSERT INTO settings (key, value_json, scope, updated_at, updated_by_device_id, version, deleted_at)
      VALUES (?, ?, 'app', ?, 'device-a', 9, NULL)
    `,
    [
      'settings.sync.fixture.preference',
      json({ locale: 'zh-CN', theme: 'dark', dataSync: { mode: 'webdav', realtime: true } }),
      updatedAt
    ]
  )

  return {
    blobChecksum,
    blobPayload,
    blobStoragePath
  }
}

async function deleteInstanceData(deletedAt: number, storageDeletedAt: string) {
  const appDb = await getAppDataDatabase()
  await appDb.deleteRecord('settings', 'sync.integration.theme', deletedAt)

  const storageClient = await storageV2Database.getClient()
  await storageClient.execute({
    sql: `
      INSERT INTO settings (key, value_json, scope, updated_at, version, deleted_at)
      VALUES (?, NULL, 'app', ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = NULL,
        updated_at = excluded.updated_at,
        version = settings.version + 1,
        deleted_at = excluded.deleted_at
    `,
    args: ['settings.sync.integration.storage', storageDeletedAt, storageDeletedAt]
  })
}

async function readInstanceState() {
  const appDb = await getAppDataDatabase()
  const appRecord = await appDb.getRecord('settings', 'sync.integration.theme')
  const storageClient = await storageV2Database.getClient()
  const storageResult = await storageClient.execute({
    sql: 'SELECT value_json FROM settings WHERE key = ?',
    args: ['settings.sync.integration.storage']
  })

  return {
    appRecord,
    storageSetting: JSON.parse(String(storageResult.rows[0]?.value_json ?? 'null'))
  }
}

async function readInstanceEntries() {
  const appDb = await getAppDataDatabase()
  const appRecord = await appDb.getRecordEntry('settings', 'sync.integration.theme')
  const storageClient = await storageV2Database.getClient()
  const storageResult = await storageClient.execute({
    sql: 'SELECT value_json, deleted_at FROM settings WHERE key = ?',
    args: ['settings.sync.integration.storage']
  })
  const storageRow = storageResult.rows[0]

  return {
    appRecord,
    storageSetting: {
      value: storageRow?.value_json == null ? null : JSON.parse(String(storageRow.value_json)),
      deletedAt: storageRow?.deleted_at == null ? null : String(storageRow.deleted_at)
    }
  }
}

function hashBuffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function readComprehensiveStorageV2State(instance: TestInstance, fixture: ComprehensiveStorageFixture) {
  const client = await storageV2Database.getClient()
  const selectOne = async <T extends Record<string, unknown>>(sql: string, args: InValue[] = []) => {
    const result = await client.execute({ sql, args })
    return (result.rows[0] ?? null) as unknown as T | null
  }
  const count = async (table: string) => {
    const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`)
    return Number(result.rows[0]?.count ?? 0)
  }
  const blobPath = path.join(instance.dataRoot, fixture.blobStoragePath)
  const blobContents = await fsp.readFile(blobPath)

  return {
    counts: {
      profiles: await count('profiles'),
      providers: await count('providers'),
      models: await count('models'),
      blobs: await count('blobs'),
      assistants: await count('assistants'),
      assistant_versions: await count('assistant_versions'),
      agents: await count('agents'),
      agent_versions: await count('agent_versions'),
      skills: await count('skills'),
      agent_skills: await count('agent_skills'),
      agent_sessions: await count('agent_sessions'),
      scheduled_tasks: await count('scheduled_tasks'),
      task_run_logs: await count('task_run_logs'),
      channels: await count('channels'),
      channel_task_subscriptions: await count('channel_task_subscriptions'),
      conversations: await count('conversations'),
      messages: await count('messages'),
      message_blocks: await count('message_blocks'),
      files: await count('files'),
      knowledge_bases: await count('knowledge_bases'),
      knowledge_items: await count('knowledge_items'),
      kv_records: await count('kv_records'),
      settings: await count('settings')
    },
    provider: await selectOne<{ name: string; config_json: string }>(
      'SELECT name, config_json FROM providers WHERE id = ?',
      ['provider-sync-full-openai']
    ),
    models: (await client.execute('SELECT id, capabilities_json FROM models ORDER BY sort_order')).rows.map((row) => ({
      id: String(row.id),
      capabilities: JSON.parse(String(row.capabilities_json))
    })),
    assistant: await selectOne<{ name: string; prompt: string; settings_json: string }>(
      'SELECT name, prompt, settings_json FROM assistants WHERE id = ?',
      ['assistant-sync-full']
    ),
    agent: await selectOne<{ name: string; configuration_json: string; allowed_tools_json: string }>(
      'SELECT name, configuration_json, allowed_tools_json FROM agents WHERE id = ?',
      ['agent-sync-full']
    ),
    agentSkill: await selectOne<{ enabled: number }>(
      'SELECT enabled FROM agent_skills WHERE agent_id = ? AND skill_id = ?',
      ['agent-sync-full', 'skill-sync-full']
    ),
    knowledgeBase: await selectOne<{ name: string; settings_json: string }>(
      'SELECT name, settings_json FROM knowledge_bases WHERE id = ?',
      ['knowledge-base-sync-full']
    ),
    knowledgeItem: await selectOne<{ status: string; file_id: string }>(
      'SELECT status, file_id FROM knowledge_items WHERE id = ?',
      ['knowledge-item-sync-full']
    ),
    conversation: await selectOne<{ title: string }>('SELECT title FROM conversations WHERE id = ?', [
      'conversation-sync-full'
    ]),
    messages: (await client.execute('SELECT id, role, metadata_json FROM messages ORDER BY created_at, id')).rows.map(
      (row) => ({
        id: String(row.id),
        role: String(row.role),
        metadata: JSON.parse(String(row.metadata_json))
      })
    ),
    messageBlocks: (await client.execute('SELECT id, type, text, blob_id FROM message_blocks ORDER BY id')).rows.map(
      (row) => ({
        id: String(row.id),
        type: String(row.type),
        text: row.text == null ? null : String(row.text),
        blobId: row.blob_id == null ? null : String(row.blob_id)
      })
    ),
    file: await selectOne<{ display_name: string; metadata_json: string }>(
      'SELECT display_name, metadata_json FROM files WHERE id = ?',
      ['file-sync-full-doc']
    ),
    scheduledTask: await selectOne<{ name: string; status: string }>(
      'SELECT name, status FROM scheduled_tasks WHERE id = ?',
      ['task-sync-full']
    ),
    channel: await selectOne<{ name: string; permission_mode: string }>(
      'SELECT name, permission_mode FROM channels WHERE id = ?',
      ['channel-sync-full']
    ),
    taskRunLog: await selectOne<{ status: string; result_json: string }>(
      'SELECT status, result_json FROM task_run_logs WHERE id = 101'
    ),
    setting: await selectOne<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [
      'settings.sync.fixture.preference'
    ]),
    kvRecord: await selectOne<{ value_json: string }>('SELECT value_json FROM kv_records WHERE scope = ? AND key = ?', [
      'ui',
      'sync.fixture.workspace'
    ]),
    blobHash: hashBuffer(blobContents),
    blobPayload: blobContents.toString('utf8')
  }
}

async function readComprehensiveLegacyRuntimeState(instance: TestInstance) {
  const client = createClient({
    url: `file:${path.join(instance.dataRoot, 'agents.db')}`,
    intMode: 'number'
  })
  const count = async (table: string) => {
    const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`)
    return Number(result.rows[0]?.count ?? 0)
  }
  const selectOne = async <T extends Record<string, unknown>>(sql: string, args: InValue[] = []) => {
    const result = await client.execute({ sql, args })
    return (result.rows[0] ?? null) as unknown as T | null
  }

  try {
    const filePath = path.join(instance.dataRoot, 'Files', 'file-sync-full-doc.txt')
    const fileContents = await fsp.readFile(filePath)

    return {
      counts: {
        agents: await count('agents'),
        sessions: await count('sessions'),
        skills: await count('skills'),
        agent_skills: await count('agent_skills'),
        scheduled_tasks: await count('scheduled_tasks'),
        task_run_logs: await count('task_run_logs'),
        channels: await count('channels'),
        channel_task_subscriptions: await count('channel_task_subscriptions'),
        session_messages: await count('session_messages')
      },
      agent: await selectOne<{ name: string; configuration: string; allowed_tools: string }>(
        'SELECT name, configuration, allowed_tools FROM agents WHERE id = ?',
        ['agent-sync-full']
      ),
      session: await selectOne<{ name: string; configuration: string }>(
        'SELECT name, configuration FROM sessions WHERE id = ?',
        ['agent-session-sync-full']
      ),
      sessionMessages: (
        await client.execute('SELECT role, content FROM session_messages ORDER BY created_at, id')
      ).rows.map((row) => ({
        role: String(row.role),
        content: String(row.content)
      })),
      fileHash: hashBuffer(fileContents),
      filePayload: fileContents.toString('utf8')
    }
  } finally {
    client.close()
  }
}

function makeConfig(server: WebDavTestServer, webdavPath = '/cherry-studio-pi-integration') {
  return {
    webdavHost: server.url,
    webdavUser: 'user',
    webdavPass: 'pass',
    webdavPath
  }
}

function makeBackupManager(tempRoot: string) {
  return {
    backup: vi.fn(async (_event: unknown, fileName: string) => {
      const backupPath = path.join(tempRoot, fileName)
      await fsp.writeFile(backupPath, `backup:${fileName}`)
      return backupPath
    }),
    restore: vi.fn()
  }
}

function remoteSyncRoot(server: WebDavTestServer, webdavPath: string) {
  const normalized = path.posix
    .normalize(`/${webdavPath}`.replace(/\\/g, '/').replace(/\/+/g, '/'))
    .replace(/\/+$/g, '')
  const basePath = normalized.endsWith('/sync/v1') ? normalized : path.posix.join(normalized, 'sync', 'v1')
  return path.join(server.root, ...basePath.split('/').filter(Boolean).map(decodeURIComponent))
}

async function readRemoteManifest(server: WebDavTestServer, webdavPath: string) {
  return JSON.parse(await fsp.readFile(path.join(remoteSyncRoot(server, webdavPath), 'manifest.json'), 'utf8'))
}

function countRemoteStorageV2Records(manifest: { storageV2?: { records?: Record<string, { entityType: string }> } }) {
  const counts: Record<string, number> = {}
  for (const record of Object.values(manifest.storageV2?.records ?? {})) {
    counts[record.entityType] = (counts[record.entityType] ?? 0) + 1
  }
  return counts
}

const COMPREHENSIVE_STORAGE_TABLE_COUNTS = {
  profiles: 1,
  providers: 1,
  models: 2,
  blobs: 1,
  assistants: 1,
  assistant_versions: 1,
  agents: 1,
  agent_versions: 1,
  skills: 1,
  agent_skills: 1,
  agent_sessions: 1,
  scheduled_tasks: 1,
  task_run_logs: 1,
  channels: 1,
  channel_task_subscriptions: 1,
  conversations: 1,
  messages: 2,
  message_blocks: 3,
  files: 1,
  knowledge_bases: 1,
  knowledge_items: 1,
  kv_records: 1,
  settings: 1
} as const

const COMPREHENSIVE_REMOTE_ENTITY_COUNTS = {
  profile: 1,
  provider: 1,
  model: 2,
  blob: 1,
  assistant: 1,
  assistant_version: 1,
  agent: 1,
  agent_version: 1,
  skill: 1,
  agent_skill: 1,
  agent_session: 1,
  scheduled_task: 1,
  task_run_log: 1,
  channel: 1,
  channel_task_subscription: 1,
  conversation: 1,
  message: 2,
  message_block: 3,
  file: 1,
  knowledge_base: 1,
  knowledge_item: 1,
  kv_record: 1,
  settings: 1
} as const

async function readAllRemoteText(root: string) {
  const values: string[] = []

  async function walk(currentPath: string) {
    for (const entry of await fsp.readdir(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else {
        values.push(await fsp.readFile(entryPath, 'utf8').catch(() => ''))
      }
    }
  }

  await walk(root)
  return values.join('\n')
}

describe('AppDataSyncService local WebDAV integration', () => {
  let tempRoot: string
  let server: WebDavTestServer | null = null

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(process.cwd(), '.context', 'webdav-sync-integration-'))
    server = await startWebDavServer(path.join(tempRoot, 'webdav-root'))
  })

  afterEach(async () => {
    await AppDataDatabase.close()
    storageV2Database.close()
    delete process.env.CHERRY_STUDIO_STORAGE_V2_ROOT
    await server?.close()
    await fsp.rm(tempRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('syncs two isolated instances through a real local WebDAV server', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const config = makeConfig(server!)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'device-a-user-value' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'device-a-storage-value' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    const serviceA = new AppDataSyncService(backupManager as never)
    const firstSummary = await serviceA.syncNow(config)

    await switchInstance(instanceB, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'device-b-default' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:20:00.000Z'),
      storageSettingValue: { owner: 'device-b-storage-default' },
      storageSettingUpdatedAt: '2026-05-29T12:20:00.000Z'
    })
    const serviceB = new AppDataSyncService(backupManager as never)
    const secondSummary = await serviceB.syncNow(config)
    const deviceBState = await readInstanceState()
    const remoteText = await readAllRemoteText(server!.root)

    expect(firstSummary.uploaded + (firstSummary.storageUploaded ?? 0)).toBeGreaterThan(0)
    expect(secondSummary.downloaded + (secondSummary.storageDownloaded ?? 0)).toBeGreaterThan(0)
    expect(secondSummary.conflicts + (secondSummary.storageConflicts ?? 0)).toBe(0)
    expect(deviceBState).toEqual({
      appRecord: { mode: 'device-a-user-value' },
      storageSetting: { owner: 'device-a-storage-value' }
    })
    expect(remoteText).toContain('device-a-user-value')
    expect(remoteText).toContain('device-a-storage-value')
    expect(remoteText).not.toContain('device-b-default')
    expect(remoteText).not.toContain('device-b-storage-default')
  })

  it('syncs comprehensive Storage v2 data across models, assistants, agents, knowledge, files, chats and settings', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const webdavPath = '/cherry-studio-pi-comprehensive'
    const config = makeConfig(server!, webdavPath)
    const backupManager = makeBackupManager(tempRoot)
    const expectedRecordCount = Object.values(COMPREHENSIVE_REMOTE_ENTITY_COUNTS).reduce((sum, count) => sum + count, 0)

    await switchInstance(instanceA, homePath)
    const fixture = await seedComprehensiveStorageV2Data(instanceA)
    const firstSummary = await new AppDataSyncService(backupManager as never).syncNow(config)
    const remoteManifest = await readRemoteManifest(server!, webdavPath)
    const remoteText = await readAllRemoteText(remoteSyncRoot(server!, webdavPath))

    expect(firstSummary.storageUploaded).toBe(expectedRecordCount)
    expect(firstSummary.blobUploaded).toBe(1)
    expect(countRemoteStorageV2Records(remoteManifest)).toEqual(COMPREHENSIVE_REMOTE_ENTITY_COUNTS)
    expect(Object.keys(remoteManifest.storageV2?.records ?? {})).toHaveLength(expectedRecordCount)
    expect(remoteManifest.storageV2?.bundle).toMatchObject({
      path: expect.stringMatching(/^storage-v2\/bundle\/[a-f0-9]{64}\.json$/),
      recordCount: expectedRecordCount,
      blobCount: 1
    })
    await expect(
      pathExists(path.join(remoteSyncRoot(server!, webdavPath), remoteManifest.storageV2!.bundle!.path))
    ).resolves.toBe(true)
    await expect(pathExists(path.join(remoteSyncRoot(server!, webdavPath), 'storage-v2', 'records'))).resolves.toBe(
      false
    )
    expect(remoteText).toContain('同步测试模型服务')
    expect(remoteText).toContain('同步测试助手')
    expect(remoteText).toContain('同步测试 Agent')
    expect(remoteText).toContain('同步测试知识库')
    expect(remoteText).toContain('settings.sync.fixture.preference')

    await switchInstance(instanceB, homePath)
    const secondSummary = await new AppDataSyncService(backupManager as never).syncNow(config)
    const deviceBState = await readComprehensiveStorageV2State(instanceB, fixture)
    const deviceBLegacyRuntimeState = await readComprehensiveLegacyRuntimeState(instanceB)

    expect(secondSummary.storageDownloaded).toBe(expectedRecordCount)
    expect(secondSummary.blobDownloaded).toBe(1)
    expect(secondSummary.storageConflicts).toBe(0)
    expect(deviceBState.counts).toEqual(COMPREHENSIVE_STORAGE_TABLE_COUNTS)
    expect(deviceBState.provider).toMatchObject({
      name: '同步测试模型服务'
    })
    expect(JSON.parse(deviceBState.provider!.config_json)).toEqual({
      apiKeySecretRef: 'storage-v2://secret/provider-sync-full-openai/apiKey',
      timeoutMs: 30000
    })
    expect(deviceBState.models).toEqual([
      { id: 'model-sync-full-chat', capabilities: ['chat', 'vision', 'tool_use'] },
      { id: 'model-sync-full-embedding', capabilities: ['embedding'] }
    ])
    expect(deviceBState.assistant).toMatchObject({
      name: '同步测试助手',
      prompt: '你是一个用于验证多端同步的助手。'
    })
    expect(JSON.parse(deviceBState.assistant!.settings_json)).toMatchObject({
      preferredLanguage: 'zh-CN'
    })
    expect(deviceBState.agent).toMatchObject({ name: '同步测试 Agent' })
    expect(JSON.parse(deviceBState.agent!.configuration_json)).toMatchObject({
      permissionMode: 'soul',
      maxToolCalls: 12
    })
    expect(JSON.parse(deviceBState.agent!.allowed_tools_json)).toContain('knowledge.search')
    expect(deviceBState.agentSkill).toEqual({ enabled: 1 })
    expect(deviceBState.knowledgeBase).toMatchObject({ name: '同步测试知识库' })
    expect(JSON.parse(deviceBState.knowledgeBase!.settings_json)).toMatchObject({ retrievalTopK: 6 })
    expect(deviceBState.knowledgeItem).toEqual({
      status: 'indexed',
      file_id: 'file-sync-full-doc'
    })
    expect(deviceBState.conversation).toEqual({ title: '同步测试对话' })
    expect(deviceBState.messages).toEqual([
      { id: 'message-sync-user', role: 'user', metadata: { source: 'manual', fixture: true } },
      { id: 'message-sync-assistant', role: 'assistant', metadata: { finishReason: 'stop', fixture: true } }
    ])
    expect(deviceBState.messageBlocks).toEqual([
      {
        id: 'message-block-sync-assistant-file',
        type: 'file',
        text: null,
        blobId: 'blob-sync-full-doc'
      },
      {
        id: 'message-block-sync-assistant-text',
        type: 'text',
        text: '已检查模型、助手、Agent、知识库和设置。',
        blobId: null
      },
      {
        id: 'message-block-sync-user-text',
        type: 'text',
        text: '请验证同步 fixture 是否完整。',
        blobId: null
      }
    ])
    expect(deviceBState.file).toMatchObject({
      display_name: '综合同步测试文档.txt'
    })
    expect(JSON.parse(deviceBState.file!.metadata_json)).toMatchObject({
      checksum: fixture.blobChecksum
    })
    expect(deviceBState.scheduledTask).toEqual({
      name: '同步测试定时任务',
      status: 'active'
    })
    expect(deviceBState.channel).toEqual({
      name: '同步测试频道',
      permission_mode: 'soul'
    })
    expect(deviceBState.taskRunLog).toMatchObject({ status: 'success' })
    expect(JSON.parse(deviceBState.taskRunLog!.result_json)).toEqual({ output: 'fixture synced' })
    expect(JSON.parse(deviceBState.setting!.value_json)).toMatchObject({
      locale: 'zh-CN',
      dataSync: { mode: 'webdav', realtime: true }
    })
    expect(JSON.parse(deviceBState.kvRecord!.value_json)).toEqual({
      layout: 'compact',
      sidebar: 'agents'
    })
    expect(deviceBState.blobHash).toBe(fixture.blobChecksum)
    expect(deviceBState.blobPayload).toBe(fixture.blobPayload)
    expect(deviceBLegacyRuntimeState.counts).toEqual({
      agents: 1,
      sessions: 1,
      skills: 1,
      agent_skills: 1,
      scheduled_tasks: 1,
      task_run_logs: 1,
      channels: 0,
      channel_task_subscriptions: 0,
      session_messages: 2
    })
    expect(deviceBLegacyRuntimeState.agent).toMatchObject({ name: '同步测试 Agent' })
    expect(JSON.parse(deviceBLegacyRuntimeState.agent!.configuration)).toMatchObject({
      permissionMode: 'soul',
      maxToolCalls: 12
    })
    expect(JSON.parse(deviceBLegacyRuntimeState.agent!.allowed_tools)).toContain('settings.write')
    expect(deviceBLegacyRuntimeState.session).toMatchObject({ name: '同步测试任务会话' })
    expect(JSON.parse(deviceBLegacyRuntimeState.session!.configuration)).toMatchObject({
      modelId: 'model-sync-full-chat',
      permissionMode: 'soul'
    })
    expect(deviceBLegacyRuntimeState.sessionMessages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(deviceBLegacyRuntimeState.sessionMessages.map((message) => message.content).join('\n')).toContain(
      '请验证同步 fixture 是否完整。'
    )
    expect(deviceBLegacyRuntimeState.sessionMessages.map((message) => message.content).join('\n')).toContain(
      '已检查模型、助手、Agent、知识库和设置。'
    )
    expect(deviceBLegacyRuntimeState.fileHash).toBe(fixture.blobChecksum)
    expect(deviceBLegacyRuntimeState.filePayload).toBe(fixture.blobPayload)
  })

  it('propagates later updates and tombstones between two devices', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const config = makeConfig(server!)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'initial-a' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'initial-a' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)

    await switchInstance(instanceB, homePath)
    const firstPull = await new AppDataSyncService(backupManager as never).syncNow(config)
    expect(firstPull.downloaded + firstPull.storageDownloaded).toBeGreaterThan(0)

    await seedInstanceData({
      appRecordValue: { mode: 'updated-by-b' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:30:00.000Z'),
      storageSettingValue: { owner: 'updated-by-b' },
      storageSettingUpdatedAt: '2026-05-29T12:30:00.000Z'
    })
    const bPush = await new AppDataSyncService(backupManager as never).syncNow(config)
    expect(bPush.uploaded + bPush.storageUploaded).toBeGreaterThan(0)

    await switchInstance(instanceA, homePath)
    const aPull = await new AppDataSyncService(backupManager as never).syncNow(config)
    expect(aPull.downloaded + aPull.storageDownloaded).toBeGreaterThan(0)
    await expect(readInstanceState()).resolves.toEqual({
      appRecord: { mode: 'updated-by-b' },
      storageSetting: { owner: 'updated-by-b' }
    })

    await switchInstance(instanceB, homePath)
    await deleteInstanceData(Date.parse('2026-05-29T12:40:00.000Z'), '2026-05-29T12:40:00.000Z')
    const bDeletePush = await new AppDataSyncService(backupManager as never).syncNow(config)
    expect(bDeletePush.deleted).toBeGreaterThan(0)
    expect(bDeletePush.storageDeleted).toBeGreaterThan(0)

    await switchInstance(instanceA, homePath)
    const aDeletePull = await new AppDataSyncService(backupManager as never).syncNow(config)
    const deletedState = await readInstanceEntries()
    expect(aDeletePull.deleted + aDeletePull.storageDeleted).toBeGreaterThan(0)
    expect(deletedState.appRecord).toMatchObject({ found: true, value: null })
    expect(deletedState.appRecord.deletedAt).toBe(Date.parse('2026-05-29T12:40:00.000Z'))
    expect(deletedState.storageSetting).toEqual({
      value: null,
      deletedAt: '2026-05-29T12:40:00.000Z'
    })
  })

  it('auto-resolves divergent edits by timestamp without accumulating conflict records', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const config = makeConfig(server!)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'baseline' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'baseline' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)

    await switchInstance(instanceB, homePath)
    await new AppDataSyncService(backupManager as never).syncNow(config)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'edited-by-a' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      storageSettingValue: { owner: 'edited-by-a' },
      storageSettingUpdatedAt: '2026-05-29T12:10:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)

    await switchInstance(instanceB, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'edited-by-b' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:20:00.000Z'),
      storageSettingValue: { owner: 'edited-by-b' },
      storageSettingUpdatedAt: '2026-05-29T12:20:00.000Z'
    })
    const conflictSummary = await new AppDataSyncService(backupManager as never).syncNow(config)
    const remoteText = await readAllRemoteText(server!.root)

    expect(conflictSummary.conflicts).toBe(0)
    expect(conflictSummary.resolvedConflicts).toBeGreaterThan(0)
    expect(conflictSummary.storageConflicts).toBe(0)
    expect(conflictSummary.storageResolvedConflicts).toBeGreaterThan(0)
    expect(remoteText).toContain('edited-by-b')
  })

  it('does not reupload records on an idempotent no-change sync', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const config = makeConfig(server!)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'stable' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'stable' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)
    const secondSummary = await new AppDataSyncService(backupManager as never).syncNow(config)

    expect(secondSummary.uploaded).toBe(0)
    expect(secondSummary.downloaded).toBe(0)
    expect(secondSummary.deleted).toBe(0)
    expect(secondSummary.conflicts).toBe(0)
    expect(secondSummary.resolvedConflicts).toBe(0)
    expect(secondSummary.storageUploaded).toBe(0)
    expect(secondSummary.storageDownloaded).toBe(0)
    expect(secondSummary.storageDeleted).toBe(0)
    expect(secondSummary.storageConflicts).toBe(0)
    expect(secondSummary.storageResolvedConflicts).toBe(0)
    expect(secondSummary.snapshotUploaded).toBe(false)
  })

  it('handles unicode and spaced WebDAV directory paths', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const webdavPath = '/同步 目录/Cherry Studio Pi'
    const config = makeConfig(server!, webdavPath)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'unicode-path' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'unicode-path' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)

    await switchInstance(instanceB, homePath)
    await new AppDataSyncService(backupManager as never).syncNow(config)

    expect(await pathExists(path.join(remoteSyncRoot(server!, webdavPath), 'manifest.json'))).toBe(true)
    await expect(readInstanceState()).resolves.toEqual({
      appRecord: { mode: 'unicode-path' },
      storageSetting: { owner: 'unicode-path' }
    })
  })

  it('fails safely when WebDAV write access is lost', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const config = makeConfig(server!)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'before-readonly' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'before-readonly' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)
    const remoteBefore = await readAllRemoteText(server!.root)

    await seedInstanceData({
      appRecordValue: { mode: 'should-not-upload' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      storageSettingValue: { owner: 'should-not-upload' },
      storageSettingUpdatedAt: '2026-05-29T12:10:00.000Z'
    })
    server!.setDenyWrites(true)

    await expect(new AppDataSyncService(backupManager as never).syncNow(config)).rejects.toThrow()
    const remoteAfter = await readAllRemoteText(server!.root)
    expect(remoteAfter).toBe(remoteBefore)
  })

  it('does not overwrite remote data when manifest metadata is corrupted', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const webdavPath = '/cherry-studio-pi-integration'
    const config = makeConfig(server!, webdavPath)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'safe-remote' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'safe-remote' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)
    const manifestPath = path.join(remoteSyncRoot(server!, webdavPath), 'manifest.json')
    await fsp.writeFile(manifestPath, '{ broken manifest', 'utf8')

    await switchInstance(instanceB, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'should-not-replace-corrupt-remote' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:20:00.000Z'),
      storageSettingValue: { owner: 'should-not-replace-corrupt-remote' },
      storageSettingUpdatedAt: '2026-05-29T12:20:00.000Z'
    })

    await expect(new AppDataSyncService(backupManager as never).syncNow(config)).rejects.toThrow(
      'Remote sync metadata is corrupted'
    )
    const remoteAfter = await readAllRemoteText(server!.root)
    await expect(fsp.readFile(manifestPath, 'utf8')).resolves.toBe('{ broken manifest')
    expect(remoteAfter).toContain('safe-remote')
    expect(remoteAfter).not.toContain('should-not-replace-corrupt-remote')
  })

  it('skips a remote record whose manifest entry points to a missing file', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const webdavPath = '/cherry-studio-pi-integration'
    const config = makeConfig(server!, webdavPath)
    const backupManager = makeBackupManager(tempRoot)

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'remote-file-present' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'remote-file-present' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    await new AppDataSyncService(backupManager as never).syncNow(config)

    const manifest = await readRemoteManifest(server!, webdavPath)
    const appMeta = manifest.records['settings:sync.integration.theme']
    await fsp.rm(path.join(remoteSyncRoot(server!, webdavPath), appMeta.path), { force: true })

    await switchInstance(instanceB, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'local-fallback' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:20:00.000Z'),
      storageSettingValue: { owner: 'local-fallback' },
      storageSettingUpdatedAt: '2026-05-29T12:20:00.000Z'
    })
    const summary = await new AppDataSyncService(backupManager as never).syncNow(config)

    expect(summary.conflicts).toBe(0)
    await expect(readInstanceState()).resolves.toMatchObject({
      appRecord: { mode: 'local-fallback' }
    })
  })
})
