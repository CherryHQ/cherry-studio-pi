import { agentTable } from '@data/db/schemas/agent'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentChannelService } from '@data/services/AgentChannelService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it } from 'vitest'

const TELEGRAM_CONFIG = { bot_token: 'test-token-123', allowed_chat_ids: [] }
const SYSTEM_WORKSPACE = { type: 'system' as const }

describe('AgentChannelService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceExport.dbService.withWriteTx.mockImplementation((fn) => dbh.db.transaction(fn as never))
    MockMainDbServiceExport.dbService.withWriteTx.mockClear()
  })

  /** Insert a minimal agent row directly so agentId FK constraints are satisfied. */
  async function insertAgent(id: string): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: `Agent ${id}`,
      instructions: 'test',
      model: null,
      orderKey: 'a0'
    })
  }

  describe('createChannel', () => {
    it('creates a channel and returns the entity', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'My Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: true
      })

      expect(channel.id).toBeTruthy()
      expect(channel.type).toBe('telegram')
      expect(channel.name).toBe('My Bot')
      expect(channel.isActive).toBe(true)
      expect(channel.config).toMatchObject({ bot_token: 'test-token-123' })
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(1)
    })

    it('creates an inactive channel', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Draft Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: false
      })

      expect(channel.isActive).toBe(false)
    })

    it('returns ISO 8601 timestamps (rowToEntity converts SQLite integer timestamps)', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Timestamp Test',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      expect(channel.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(channel.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('getChannel', () => {
    it('returns channel by id', async () => {
      const created = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Get Test',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const found = agentChannelService.getChannel(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('returns null for unknown id', async () => {
      const result = agentChannelService.getChannel('nonexistent-id')
      expect(result).toBeNull()
    })
  })

  describe('listChannels', () => {
    it('lists all channels when no filters applied', async () => {
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })
      agentChannelService.createChannel({
        type: 'discord',
        name: 'DC',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'dc-token' }
      })

      const channels = agentChannelService.listChannels()
      expect(channels.length).toBeGreaterThanOrEqual(2)
    })

    it('filters by type', async () => {
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Filter',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const channels = agentChannelService.listChannels({ type: 'telegram' })
      expect(channels.every((c) => c.type === 'telegram')).toBe(true)
    })

    it('filters by agentId alone', async () => {
      const agentId = `agent-filter-${Date.now()}`
      await insertAgent(agentId)
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'AgentA Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        agentId
      })
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'No-Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
        // agentId intentionally omitted
      })

      const channels = agentChannelService.listChannels({ agentId })
      expect(channels.length).toBeGreaterThanOrEqual(1)
      expect(channels.every((c) => c.agentId === agentId)).toBe(true)
    })

    it('filters by agentId AND type combined (both eq predicates compose)', async () => {
      const agentId = `agent-combo-${Date.now()}`
      await insertAgent(agentId)
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        agentId
      })
      agentChannelService.createChannel({
        type: 'discord',
        name: 'DC Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'dc-tok' },
        agentId
      })
      // telegram channel for a different agent — must NOT appear
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Other Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const channels = agentChannelService.listChannels({ agentId, type: 'telegram' })
      expect(channels.length).toBeGreaterThanOrEqual(1)
      expect(channels.every((c) => c.agentId === agentId && c.type === 'telegram')).toBe(true)
    })
  })

  describe('updateChannel', () => {
    it('updates channel name', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Before',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const updated = agentChannelService.updateChannel(channel.id, { name: 'After' })
      expect(updated!.name).toBe('After')
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(2)
    })

    it('returns null when channel does not exist', async () => {
      const result = agentChannelService.updateChannel('nonexistent', { name: 'x' })
      expect(result).toBeNull()
    })

    it('toggles isActive', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Toggle',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: true
      })

      const updated = agentChannelService.updateChannel(channel.id, { isActive: false })
      expect(updated!.isActive).toBe(false)
    })
  })

  describe('addActiveChatId', () => {
    it('appends a new chat id inside one serialized read-modify-write transaction', async () => {
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Active Chats',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      MockMainDbServiceExport.dbService.withWriteTx.mockClear()
      await agentChannelService.addActiveChatId(channel.id, 'chat-1')
      await agentChannelService.addActiveChatId(channel.id, 'chat-1')

      const updated = await agentChannelService.getChannel(channel.id)
      expect(updated?.activeChatIds).toEqual(['chat-1'])
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(2)
    })
  })

  describe('normalizeChannelConfig (via createChannel)', () => {
    it('strips the type key from the stored config', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Norm Test',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'tok', type: 'telegram' } as any
      })

      expect(channel.config).not.toHaveProperty('type')
      expect((channel.config as any).bot_token).toBe('tok')
    })

    it('stores an empty object when config is a non-object value', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Non-obj Config',
        workspace: SYSTEM_WORKSPACE,
        config: 'bad-value' as any
      })

      expect(channel.config).toEqual({})
    })
  })

  describe('deleteChannel', () => {
    it('deletes a channel and returns true', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'To Delete',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const deleted = agentChannelService.deleteChannel(channel.id)
      expect(deleted).toBe(true)
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(2)

      const found = agentChannelService.getChannel(channel.id)
      expect(found).toBeNull()
    })

    it('returns false when channel does not exist', async () => {
      const result = agentChannelService.deleteChannel('nonexistent')
      expect(result).toBe(false)
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(1)
    })
  })

  describe('task subscriptions', () => {
    it('subscribes and unsubscribes through serialized write transactions', async () => {
      await dbh.db.insert(jobScheduleTable).values({
        id: 'task-1',
        type: 'agent.task',
        name: 'task-1',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Task Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      MockMainDbServiceExport.dbService.withWriteTx.mockClear()
      await agentChannelService.subscribeToTask(channel.id, 'task-1')
      await expect(agentChannelService.getSubscribedTasks(channel.id)).resolves.toEqual(['task-1'])

      await agentChannelService.unsubscribeFromTask(channel.id, 'task-1')
      await expect(agentChannelService.getSubscribedTasks(channel.id)).resolves.toEqual([])
      expect(MockMainDbServiceExport.dbService.withWriteTx).toHaveBeenCalledTimes(2)
    })
  })
})
