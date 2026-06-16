import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    all: vi.fn()
  },
  application: {
    get: vi.fn()
  },
  agentRuntimeWrite: {
    upsertAgent: vi.fn(),
    upsertAgentSession: vi.fn(),
    upsertChannel: vi.fn(),
    upsertScheduledTask: vi.fn()
  },
  conversationRepository: {
    upsertMessage: vi.fn(),
    upsertMessageBlocks: vi.fn()
  },
  storageClient: {
    execute: vi.fn()
  },
  storageDatabase: {
    getClient: vi.fn(),
    withTransaction: vi.fn()
  },
  syncLog: {
    recordChange: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: mocks.application
}))

vi.mock('../AgentRuntimeWriteService', () => ({
  storageV2AgentRuntimeWriteService: mocks.agentRuntimeWrite
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2ConversationRepository: mocks.conversationRepository
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: mocks.storageDatabase
}))

vi.mock('../SyncLogService', () => ({
  storageV2SyncLogService: mocks.syncLog
}))

import { StorageV2DataApiAgentRuntimeMirrorService } from '../DataApiAgentRuntimeMirrorService'

describe('StorageV2DataApiAgentRuntimeMirrorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.application.get.mockReturnValue({ getDb: () => mocks.db })
    mocks.storageDatabase.getClient.mockResolvedValue(mocks.storageClient)
    mocks.storageDatabase.withTransaction.mockImplementation(async (_client: unknown, fn: () => Promise<void>) => fn())
    mocks.storageClient.execute.mockResolvedValue({
      rowsAffected: 1,
      rows: [{ version: 2 }],
      columns: [],
      columnTypes: []
    })
  })

  it('mirrors DataApi agent runtime rows into Storage v2', async () => {
    mocks.db.all
      .mockResolvedValueOnce([
        {
          id: 'agent-1',
          type: 'pi',
          name: 'Agent',
          description: 'desc',
          instructions: 'be useful',
          model: 'openai::gpt-4o',
          plan_model: null,
          small_model: null,
          mcps: JSON.stringify(['filesystem']),
          disabled_tools: JSON.stringify(['Shell']),
          configuration: JSON.stringify({ permission_mode: 'bypassPermissions' }),
          sort_order: 0,
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'session-1',
          agent_id: 'agent-1',
          agent_type: 'pi',
          name: 'Session',
          description: 'session desc',
          workspace_path: '/tmp/workspace',
          trace_id: 'trace-1',
          instructions: 'be useful',
          model: 'openai::gpt-4o',
          plan_model: null,
          small_model: null,
          mcps: JSON.stringify(['filesystem']),
          disabled_tools: JSON.stringify(['Shell']),
          configuration: JSON.stringify({ permission_mode: 'bypassPermissions' }),
          sort_order: 0,
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'message-1',
          session_id: 'session-1',
          role: 'assistant',
          status: 'success',
          data: JSON.stringify({ parts: [{ type: 'text', text: 'hello' }] }),
          searchable_text: 'hello',
          model_id: 'openai::gpt-4o',
          model_snapshot: JSON.stringify({ id: 'openai::gpt-4o' }),
          stats: JSON.stringify({ completion_tokens: 1 }),
          runtime_resume_token: 'resume-1',
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: 'Skill',
          description: 'skill desc',
          folder_name: 'skill',
          source: 'local',
          source_url: null,
          namespace: null,
          author: null,
          tags: JSON.stringify(['agent']),
          content_hash: 'hash',
          is_enabled: 1,
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          agent_id: 'agent-1',
          skill_id: 'skill-1',
          is_enabled: 1,
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'channel-1',
          type: 'telegram',
          name: 'Telegram',
          agent_id: 'agent-1',
          session_id: 'session-1',
          workspace: JSON.stringify({ type: 'system' }),
          config: JSON.stringify({ bot_token: 'secret', allowed_chat_ids: [] }),
          is_active: 1,
          active_chat_ids: JSON.stringify(['chat-1']),
          permission_mode: 'bypassPermissions',
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          name: 'Task',
          trigger: JSON.stringify({ kind: 'interval', ms: 60000 }),
          job_input_template: JSON.stringify({
            agentId: 'agent-1',
            prompt: 'do it',
            timeoutMinutes: 5
          }),
          enabled: 1,
          next_run: 3000,
          last_run: 2000,
          created_at: 1000,
          updated_at: 2000
        }
      ])
      .mockResolvedValueOnce([{ channel_id: 'channel-1', task_id: 'task-1' }])

    await new StorageV2DataApiAgentRuntimeMirrorService().flushStrict()

    expect(mocks.agentRuntimeWrite.upsertAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        type: 'pi',
        model: 'openai::gpt-4o',
        configuration: expect.objectContaining({
          permission_mode: 'bypassPermissions',
          disabledTools: ['Shell']
        })
      })
    )
    expect(mocks.agentRuntimeWrite.upsertAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-1',
        accessible_paths: JSON.stringify(['/tmp/workspace']),
        mcps: JSON.stringify(['filesystem']),
        configuration: expect.stringContaining('trace-1')
      })
    )
    expect(mocks.conversationRepository.upsertMessage).toHaveBeenCalledWith(
      'agent-session:session-1',
      expect.objectContaining({
        id: 'message-1',
        role: 'assistant',
        blocks: [expect.objectContaining({ text: 'hello' })]
      })
    )
    expect(mocks.conversationRepository.upsertMessageBlocks).toHaveBeenCalledWith(
      'message-1',
      [expect.objectContaining({ text: 'hello' })],
      { pruneMissing: true }
    )
    expect(mocks.syncLog.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'skill',
        entityId: 'skill-1'
      })
    )
    expect(mocks.syncLog.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'agent_skill',
        entityId: '["agent-1","skill-1"]'
      })
    )
    expect(mocks.agentRuntimeWrite.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'channel-1',
        activeChatIds: ['chat-1'],
        config: expect.objectContaining({
          workspace: { type: 'system' }
        })
      })
    )
    expect(mocks.agentRuntimeWrite.upsertScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        agent_id: 'agent-1',
        schedule_type: 'interval',
        schedule_value: '60000',
        timeout_minutes: 5
      }),
      ['channel-1']
    )
  })
})
