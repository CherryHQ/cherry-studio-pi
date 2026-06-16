import type { Client } from '@libsql/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storageV2Database } from '../StorageV2Database'
import {
  StorageV2ConversationRepository,
  StorageV2FileRepository,
  StorageV2KnowledgeRepository,
  StorageV2ProviderRepository
} from '../StorageV2Repositories'
import { encodeStorageV2CompositeEntityId } from '../SyncEntityId'
import { storageV2SyncLogService } from '../SyncLogService'

function createMockClient() {
  const execute = vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === 'string' ? input : input.sql
    const args = typeof input === 'string' ? [] : (input.args ?? [])

    if (sql.includes('SELECT version FROM')) {
      return { rows: [{ version: 3 }], columns: [], columnTypes: [] }
    }

    if (sql.includes('FROM messages') && sql.includes('WHERE conversation_id = ?') && args[0] === 'topic-1') {
      return { rows: [{ id: 'stale-message', version: 4 }], columns: [], columnTypes: [] }
    }

    if (sql.includes('FROM message_blocks b') && sql.includes('m.conversation_id = ?') && args[0] === 'topic-1') {
      return {
        rows: [{ id: 'stale-block', message_id: 'stale-message', version: 2 }],
        columns: [],
        columnTypes: []
      }
    }

    if (sql.includes('FROM message_blocks') && sql.includes('WHERE message_id = ?') && args[0] === 'stale-message') {
      return { rows: [{ id: 'stale-block', version: 2 }], columns: [], columnTypes: [] }
    }

    if (sql.includes('FROM message_blocks') && sql.includes('WHERE message_id = ?') && args[0] === 'message-1') {
      return { rows: [{ id: 'stale-message-block', version: 5 }], columns: [], columnTypes: [] }
    }

    return { rows: [], columns: [], columnTypes: [] }
  })

  return {
    client: { execute } as unknown as Client,
    execute
  }
}

describe('StorageV2ConversationRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('syncs a conversation snapshot in one transaction and tombstones missing children', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    const withTransaction = vi
      .spyOn(storageV2Database, 'withTransaction')
      .mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ConversationRepository().importConversation({
      id: 'topic-1',
      ownerId: 'assistant-1',
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          createdAt: '2026-01-01T00:00:00.000Z',
          blocks: ['block-1']
        }
      ],
      blocks: [
        {
          id: 'block-1',
          messageId: 'message-1',
          type: 'main_text',
          content: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })

    const executedSql = execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(withTransaction).toHaveBeenCalledTimes(1)
    expect(executedSql.some((sql) => sql.includes('INSERT INTO conversations'))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('INSERT INTO messages'))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('INSERT INTO message_blocks'))).toBe(true)
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'conversation', entityId: 'topic-1' })
    )
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'message', entityId: 'message-1' }))
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'block-1' })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message', entityId: 'stale-message', operation: 'delete' })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'stale-block', operation: 'delete' })
    )
  })

  it('can import a conversation without pruning missing children', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ConversationRepository().importConversation(
      {
        id: 'topic-1',
        ownerId: 'assistant-1',
        messages: [{ id: 'message-1', role: 'assistant', createdAt: '2026-01-01T00:00:00.000Z' }],
        blocks: []
      },
      { pruneMissingBlocks: false, pruneMissingMessages: false }
    )

    const executedSql = execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(executedSql.some((sql) => sql.includes('UPDATE messages'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('UPDATE message_blocks'))).toBe(false)
    expect(recordChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message', entityId: 'stale-message', operation: 'delete' })
    )
    expect(recordChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'stale-block', operation: 'delete' })
    )
  })

  it('only prunes missing message blocks when requested', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    const repository = new StorageV2ConversationRepository()
    await repository.upsertMessageBlocks('message-1', [{ id: 'block-1', type: 'main_text', content: 'hello' }])
    expect(recordChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'stale-message-block', operation: 'delete' })
    )

    await repository.upsertMessageBlocks('message-1', [{ id: 'block-1', type: 'main_text', content: 'hello' }], {
      pruneMissing: true
    })

    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'stale-message-block', operation: 'delete' })
    )
    expect(
      execute.mock.calls.some(([input]) => typeof input !== 'string' && input.sql.includes('UPDATE message_blocks'))
    ).toBe(true)
  })

  it('can tombstone a conversation inside a caller-owned transaction', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    const withTransaction = vi
      .spyOn(storageV2Database, 'withTransaction')
      .mockImplementation(async (_client, fn) => fn())

    await expect(
      new StorageV2ConversationRepository().deleteWithClient(client, 'topic-1', '2026-01-01T00:00:00.000Z')
    ).resolves.toEqual({ deleted: true })

    expect(withTransaction).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE conversations'),
        args: ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'topic-1']
      })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message_block', entityId: 'stale-block', operation: 'delete', version: 3 })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'message', entityId: 'stale-message', operation: 'delete', version: 5 })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'conversation', entityId: 'topic-1', operation: 'delete', version: 4 })
    )
  })

  it('normalizes invalid message pagination before querying SQLite', async () => {
    const execute = vi.fn(async () => ({ rows: [], columns: [], columnTypes: [] }))
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue({ execute } as unknown as Client)

    const repository = new StorageV2ConversationRepository()
    await repository.listMessages('topic-1', { limit: Number.NaN, offset: -10 })
    await repository.listMessages('topic-2', { limit: '5000' as any, offset: '2.8' as any })
    await repository.listMessages('topic-3', { limit: '' as any, offset: '' as any })

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        args: ['topic-1', 200, 0]
      })
    )
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        args: ['topic-2', 1000, 2]
      })
    )
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        args: ['topic-3', 200, 0]
      })
    )
  })

  it('normalizes optional conversation pagination before querying SQLite', async () => {
    const execute = vi.fn(async () => ({ rows: [], columns: [], columnTypes: [] }))
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue({ execute } as unknown as Client)

    await new StorageV2ConversationRepository().list({
      ownerType: 'assistant',
      limit: '5000' as any,
      offset: '2.8' as any
    })

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('LIMIT ? OFFSET ?'),
        args: ['assistant', 1000, 2]
      })
    )
  })
})

describe('StorageV2FileRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes optional file pagination before querying SQLite', async () => {
    const execute = vi.fn(async () => ({ rows: [], columns: [], columnTypes: [] }))
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue({ execute } as unknown as Client)

    await new StorageV2FileRepository().list({ limit: Number.NaN, offset: -10 })

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('LIMIT ? OFFSET ?'),
        args: [200, 0]
      })
    )
  })
})

describe('StorageV2ProviderRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves provider credentials when a new api key cannot be stored', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    const result = await new StorageV2ProviderRepository().upsert({
      id: 'provider-1',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'new-secret',
      models: []
    } as any)

    expect(result.skippedSecret).toBe(true)
    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' &&
          input.sql.includes('DELETE FROM provider_credentials') &&
          input.args?.[0] === 'provider-1'
      )
    ).toBe(false)
    expect(recordChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider_credential',
        entityId: encodeStorageV2CompositeEntityId(['provider-1', 'apiKey']),
        operation: 'delete'
      })
    )
  })

  it('preserves existing provider credentials when metadata snapshots do not carry api keys', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    const result = await new StorageV2ProviderRepository().upsert({
      id: 'provider-1',
      type: 'openai',
      name: 'OpenAI',
      apiKey: '',
      models: []
    } as any)

    expect(result.skippedSecret).toBe(false)
    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' &&
          input.sql.includes('DELETE FROM provider_credentials') &&
          input.args?.[0] === 'provider-1'
      )
    ).toBe(false)
    expect(recordChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider_credential',
        entityId: encodeStorageV2CompositeEntityId(['provider-1', 'apiKey']),
        operation: 'delete'
      })
    )
  })

  it('stores provider api key list credential refs without leaking plaintext keys into provider config', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    const result = await new StorageV2ProviderRepository().upsert(
      {
        id: 'provider-1',
        type: 'openai',
        name: 'OpenAI',
        apiKeys: [{ id: 'key-a', key: 'sk-a', isEnabled: true }],
        models: []
      } as any,
      0,
      {
        apiKeys: 'storage-v2://secret/provider/provider-1/apiKeys',
        apiKey: 'storage-v2://secret/provider/provider-1/apiKey'
      }
    )

    expect(result.skippedSecret).toBe(false)
    const providerInsert = execute.mock.calls.find(
      ([input]) => typeof input !== 'string' && input.sql.includes('INSERT INTO providers')
    )
    expect(providerInsert).toBeDefined()
    const providerConfigJson = (providerInsert?.[0] as { args?: unknown[] }).args?.[6]
    expect(JSON.stringify(providerConfigJson)).not.toContain('sk-a')
    expect(JSON.parse(String(providerConfigJson))).toEqual(
      expect.objectContaining({
        apiKeys: [{ id: 'key-a', isEnabled: true }]
      })
    )
    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' &&
          input.sql.includes('INSERT INTO provider_credentials') &&
          input.args?.[1] === 'apiKeys' &&
          input.args?.[2] === 'storage-v2://secret/provider/provider-1/apiKeys'
      )
    ).toBe(true)
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider_credential',
        entityId: encodeStorageV2CompositeEntityId(['provider-1', 'apiKeys'])
      })
    )
  })

  it('stores provider auth config refs without leaking plaintext auth secrets into provider config', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ProviderRepository().upsert(
      {
        id: 'provider-1',
        type: 'bedrock',
        name: 'Bedrock',
        authConfig: {
          type: 'iam-aws',
          region: 'us-east-1',
          accessKeyId: 'ak',
          secretAccessKey: 'sk-secret'
        },
        models: []
      } as any,
      0,
      {
        authConfig: 'storage-v2://secret/provider/provider-1/authConfig'
      }
    )

    const providerInsert = execute.mock.calls.find(
      ([input]) => typeof input !== 'string' && input.sql.includes('INSERT INTO providers')
    )
    const providerConfigJson = (providerInsert?.[0] as { args?: unknown[] }).args?.[6]
    expect(JSON.stringify(providerConfigJson)).not.toContain('sk-secret')
    expect(JSON.parse(String(providerConfigJson))).toEqual(
      expect.objectContaining({
        authConfig: {
          type: 'iam-aws',
          region: 'us-east-1',
          accessKeyId: 'ak'
        }
      })
    )
    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' &&
          input.sql.includes('INSERT INTO provider_credentials') &&
          input.args?.[1] === 'authConfig'
      )
    ).toBe(true)
  })

  it('preserves existing model rows during metadata-only provider mirrors', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ProviderRepository().upsert(
      {
        id: 'provider-1',
        presetProviderId: 'openai',
        name: 'OpenAI',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://api.openai.com/v1' }
        },
        isEnabled: false
      } as any,
      3,
      undefined,
      { preserveModels: true }
    )

    const providerInsert = execute.mock.calls.find(
      ([input]) => typeof input !== 'string' && input.sql.includes('INSERT INTO providers')
    )
    expect((providerInsert?.[0] as { args?: unknown[] }).args).toEqual(
      expect.arrayContaining(['provider-1', 'openai', 'OpenAI', 'https://api.openai.com/v1', 0, 3])
    )
    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' && (input.sql.includes('UPDATE models') || input.sql.includes('INSERT INTO models'))
      )
    ).toBe(false)
  })

  it('clears provider api key list credential refs without rewriting provider metadata', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await expect(
      new StorageV2ProviderRepository().upsertCredentials('provider-1', undefined, {
        clearCredentialKinds: ['apiKey', 'apiKeys']
      })
    ).resolves.toBeUndefined()

    expect(
      execute.mock.calls.some(([input]) => typeof input !== 'string' && input.sql.includes('INSERT INTO providers'))
    ).toBe(false)
    expect(
      execute.mock.calls.filter(
        ([input]) => typeof input !== 'string' && input.sql.includes('DELETE FROM provider_credentials')
      )
    ).toHaveLength(2)
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider_credential',
        entityId: encodeStorageV2CompositeEntityId(['provider-1', 'apiKeys']),
        operation: 'delete'
      })
    )
  })

  it('records provider credential tombstones when deleting a provider', async () => {
    const { client, execute } = createMockClient()
    const recordChange = vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await expect(new StorageV2ProviderRepository().delete('provider-1')).resolves.toEqual({ deleted: true })

    expect(
      execute.mock.calls.some(
        ([input]) =>
          typeof input !== 'string' &&
          input.sql.includes('DELETE FROM provider_credentials') &&
          input.args?.[0] === 'provider-1'
      )
    ).toBe(true)
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider_credential',
        entityId: encodeStorageV2CompositeEntityId(['provider-1', 'apiKey']),
        operation: 'delete'
      })
    )
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'provider',
        entityId: 'provider-1',
        operation: 'delete'
      })
    )
  })

  it('soft deletes missing provider models instead of hard deleting model rows', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ProviderRepository().upsert({
      id: 'provider-1',
      type: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
    } as any)

    const executedSql = execute.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.sql))
    expect(executedSql.some((sql) => sql.includes('DELETE FROM models'))).toBe(false)
    expect(executedSql.some((sql) => sql.includes('INSERT INTO models') && sql.includes('ON CONFLICT(id)'))).toBe(true)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE models'),
        args: [expect.any(String), expect.any(String), 'provider-1', 'provider-1::gpt-4o']
      })
    )
  })

  it('deduplicates provider models before writing Storage v2 rows', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ProviderRepository().upsert({
      id: 'provider-1',
      type: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'Old GPT-4o' },
        { id: 'gpt-4o', name: 'GPT-4o' }
      ]
    } as any)

    const modelInsertCalls = execute.mock.calls.filter(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO models')
    })

    expect(modelInsertCalls).toHaveLength(1)
    expect(modelInsertCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining(['provider-1::gpt-4o', 'GPT-4o'])
      })
    )
  })

  it('stores provider model rows with UniqueModelId-compatible ids', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2ProviderRepository().upsert({
      id: 'provider-1',
      type: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'provider-1::gpt-4o', name: 'GPT-4o unique' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
      ]
    } as any)

    const modelInsertCalls = execute.mock.calls.filter(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO models')
    })

    expect(modelInsertCalls).toHaveLength(2)
    const [firstCall, secondCall] = modelInsertCalls
    if (!firstCall || !secondCall) {
      throw new Error('Expected two model insert calls')
    }
    const firstArgs = (firstCall[0] as { args: unknown[] }).args
    const secondArgs = (secondCall[0] as { args: unknown[] }).args

    expect(firstArgs[0]).toBe('provider-1::gpt-4o')
    expect(firstArgs[1]).toBe('provider-1')
    expect(firstArgs[2]).toBe('GPT-4o unique')
    expect(JSON.parse(String(firstArgs[5]))).toMatchObject({ id: 'gpt-4o', provider: 'provider-1' })

    expect(secondArgs[0]).toBe('provider-1::gpt-4o-mini')
    expect(secondArgs[1]).toBe('provider-1')
    expect(secondArgs[2]).toBe('GPT-4o Mini')
    expect(JSON.parse(String(secondArgs[5]))).toMatchObject({ id: 'gpt-4o-mini', provider: 'provider-1' })
  })
})

describe('StorageV2KnowledgeRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reconstructs knowledge bases from structured Storage v2 tables', async () => {
    const execute = vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('FROM knowledge_bases')) {
        return {
          rows: [
            {
              id: 'base-1',
              name: 'Docs',
              model_id: 'embedding-model',
              rerank_model_id: 'rerank-model',
              settings_json: JSON.stringify({
                id: 'base-1',
                name: 'Docs',
                model: { id: 'embedding-model', name: 'Embedding Model' },
                items: [],
                created_at: 1760000000000,
                updated_at: 1760000000100,
                version: 2
              }),
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:01.000Z',
              version: 2
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      if (sql.includes('FROM knowledge_items')) {
        return {
          rows: [
            {
              id: 'item-1',
              knowledge_base_id: 'base-1',
              source_type: 'url',
              source_uri: 'https://example.com/docs',
              file_id: null,
              content_hash: 'unique-1',
              status: 'completed',
              metadata_json: JSON.stringify({
                id: 'item-1',
                type: 'url',
                content: 'https://example.com/docs',
                created_at: 1760000000200,
                updated_at: 1760000000300
              }),
              created_at: '2026-01-01T00:00:02.000Z',
              updated_at: '2026-01-01T00:00:03.000Z',
              version: 1
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      return { rows: [], columns: [], columnTypes: [] }
    })

    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue({ execute } as unknown as Client)

    await expect(new StorageV2KnowledgeRepository().listBases()).resolves.toEqual([
      expect.objectContaining({
        id: 'base-1',
        name: 'Docs',
        model: { id: 'embedding-model', name: 'Embedding Model' },
        items: [
          expect.objectContaining({
            id: 'item-1',
            baseId: 'base-1',
            type: 'url',
            content: 'https://example.com/docs',
            uniqueId: 'unique-1',
            processingStatus: 'completed'
          })
        ]
      })
    ])
  })

  it('reconstructs structured embedding and rerank model ids when snapshots are sparse', async () => {
    const execute = vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('FROM knowledge_bases')) {
        return {
          rows: [
            {
              id: 'base-1',
              name: 'Docs',
              model_id: null,
              embedding_model_id: 'openai::text-embedding-3-small',
              rerank_model_id: 'jina::rerank',
              settings_json: JSON.stringify({ id: 'base-1', name: 'Docs', items: [] }),
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:01.000Z',
              version: 2
            }
          ],
          columns: [],
          columnTypes: []
        }
      }

      return { rows: [], columns: [], columnTypes: [] }
    })

    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue({ execute } as unknown as Client)

    await expect(new StorageV2KnowledgeRepository().listBases()).resolves.toEqual([
      expect.objectContaining({
        id: 'base-1',
        embeddingModelId: 'openai::text-embedding-3-small',
        model: {
          id: 'text-embedding-3-small',
          name: 'text-embedding-3-small',
          provider: 'openai',
          group: 'openai'
        },
        rerankModelId: 'jina::rerank',
        rerankModel: {
          id: 'rerank',
          name: 'rerank',
          provider: 'jina',
          group: 'jina'
        }
      })
    ])
  })

  it('persists structured knowledge model ids during import', async () => {
    const { client, execute } = createMockClient()
    vi.spyOn(storageV2SyncLogService, 'recordChange').mockResolvedValue(undefined)
    vi.spyOn(storageV2Database, 'withTransaction').mockImplementation(async (_client, fn) => fn())
    vi.spyOn(storageV2Database, 'getClient').mockResolvedValue(client)

    await new StorageV2KnowledgeRepository().importBases(
      [
        {
          id: 'base-1',
          name: 'Docs',
          embeddingModelId: 'openai::text-embedding-3-small',
          rerankModelId: 'jina::rerank',
          items: []
        }
      ],
      { pruneMissing: false }
    )

    const baseInsertCall = execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO knowledge_bases')
    })

    const args = typeof baseInsertCall?.[0] === 'string' ? [] : baseInsertCall?.[0].args
    expect(args?.slice(0, 5)).toEqual([
      'base-1',
      'Docs',
      'openai::text-embedding-3-small',
      'openai::text-embedding-3-small',
      'jina::rerank'
    ])
  })
})
