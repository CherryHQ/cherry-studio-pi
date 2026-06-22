import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { pinService } from '@data/services/PinService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { encodeStorageV2CompositeEntityId } from '@main/services/storageV2/SyncEntityId'
import { isPathInsideOrEqual } from '@main/utils/file/path'
import { sql } from 'drizzle-orm'

import { storageV2AgentRuntimeWriteService } from './AgentRuntimeWriteService'
import { storageV2SecretVaultService } from './SecretVaultService'
import { storageV2Database } from './StorageV2Database'
import { storageV2ConversationRepository } from './StorageV2Repositories'
import { storageV2SyncLogService } from './SyncLogService'

const logger = loggerService.withContext('StorageV2DataApiAgentRuntimeMirrorService')
const CHANNEL_SECRET_KEYS = [
  'app_secret',
  'app_token',
  'bot_token',
  'client_secret',
  'encrypt_key',
  'verification_token'
] as const
const SUPPORTED_CHANNEL_TYPES = new Set(['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack'])
const SUPPORTED_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan'])

type DataApiAgentRow = {
  id: string
  type: string
  name: string
  description: string | null
  instructions: string | null
  model: string | null
  plan_model: string | null
  small_model: string | null
  mcps: unknown
  disabled_tools: unknown
  configuration: unknown
  sort_order: number
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiSessionRow = {
  id: string
  agent_id: string
  agent_type: string
  name: string
  description: string | null
  workspace_path: string | null
  trace_id: string | null
  instructions: string | null
  model: string | null
  plan_model: string | null
  small_model: string | null
  mcps: unknown
  disabled_tools: unknown
  configuration: unknown
  sort_order: number
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiMessageRow = {
  id: string
  session_id: string
  role: string
  status: string
  data: unknown
  searchable_text: string | null
  model_id: string | null
  model_snapshot: unknown
  stats: unknown
  runtime_resume_token: string | null
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiSkillRow = {
  id: string
  name: string
  description: string | null
  folder_name: string
  source: string
  source_url: string | null
  namespace: string | null
  author: string | null
  tags: unknown
  content_hash: string | null
  is_enabled: number | boolean | null
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiAgentSkillRow = {
  agent_id: string
  skill_id: string
  is_enabled: number | boolean | null
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiChannelRow = {
  id: string
  type: string
  name: string
  agent_id: string | null
  session_id: string | null
  workspace: unknown
  config: unknown
  is_active: number | boolean | null
  active_chat_ids: unknown
  permission_mode: string | null
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiTaskRow = {
  id: string
  name: string | null
  trigger: unknown
  job_input_template: unknown
  enabled: number | boolean | null
  next_run: number | string | null
  last_run: number | string | null
  created_at: number | string | null
  updated_at: number | string | null
}

type DataApiTaskSubscriptionRow = {
  channel_id: string
  task_id: string
}

type StorageAgentRow = {
  id: string
  type: string
  name: string
  description: string | null
  instructions: string | null
  model_id: string | null
  plan_model_id: string | null
  small_model_id: string | null
  mcps_json: unknown
  configuration_json: unknown
  sort_order: number | string | null
  created_at: string | null
  updated_at: string | null
}

type StorageSessionRow = {
  id: string
  agent_id: string
  name: string
  inherited_config_json: unknown
  current_config_json: unknown
  sort_order: number | string | null
  created_at: string | null
  updated_at: string | null
}

type StorageMessageRow = {
  id: string
  session_id: string
  role: string
  status: string | null
  model_id: string | null
  token_usage_json: unknown
  metadata_json: unknown
  created_at: string | null
  updated_at: string | null
}

type StorageMessageBlockRow = {
  id: string
  message_id: string
  type: string
  text: string | null
  payload_json: unknown
  ordinal: number | string | null
}

type StorageSkillRow = {
  id: string
  name: string
  description: string | null
  folder_name: string
  source: string
  source_url: string | null
  namespace: string | null
  author: string | null
  tags_json: unknown
  content_hash: string | null
  created_at: string | null
  updated_at: string | null
}

type StorageAgentSkillRow = {
  agent_id: string
  skill_id: string
  enabled: number | boolean | null
  created_at: string | null
  updated_at: string | null
}

type StorageChannelRow = {
  id: string
  type: string
  name: string
  agent_id: string | null
  session_id: string | null
  config_json: unknown
  is_active: number | boolean | null
  active_chat_ids_json: unknown
  permission_mode: string | null
  created_at: string | null
  updated_at: string | null
}

type StorageScheduledTaskRow = {
  id: string
  agent_id: string
  name: string
  prompt: string
  schedule_type: string
  schedule_value: string
  timeout_minutes: number | string | null
  next_run: string | null
  last_run: string | null
  last_result: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type StorageChannelTaskSubscriptionRow = {
  channel_id: string
  task_id: string
}

type StorageDeletedAgentRuntimeRows = {
  agentIds: string[]
  sessionIds: string[]
  messageIds: string[]
  skillIds: string[]
  channelIds: string[]
  taskIds: string[]
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value as T

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toJson(value: unknown) {
  return JSON.stringify(value ?? null)
}

function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && value.length >= 10) return new Date(numeric).toISOString()

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()

    return value
  }
  return fallback
}

function toEpochMs(value: unknown, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && value.length >= 10) return numeric

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function toEpochMsOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = toEpochMs(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function toInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return fallback
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === '1'
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function firstString(value: unknown): string | null {
  const array = asStringArray(value)
  return array[0] ?? null
}

function uniqueStrings(rows: Array<{ id: unknown }>): string[] {
  return Array.from(
    new Set(rows.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0))
  )
}

function asStringArray(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

function buildTriggerRuntimeFields(triggerValue: unknown) {
  const trigger = asRecord(triggerValue)
  const kind = typeof trigger.kind === 'string' ? trigger.kind : 'once'

  if (kind === 'cron') {
    return {
      scheduleType: 'cron',
      scheduleValue: typeof trigger.expr === 'string' ? trigger.expr : ''
    }
  }

  if (kind === 'interval') {
    return {
      scheduleType: 'interval',
      scheduleValue: typeof trigger.ms === 'number' ? String(trigger.ms) : String(trigger.ms ?? '')
    }
  }

  return {
    scheduleType: 'once',
    scheduleValue: typeof trigger.at === 'number' ? String(trigger.at) : String(trigger.at ?? '')
  }
}

function normalizeMessageBlocks(message: DataApiMessageRow) {
  const data = parseJson<Record<string, unknown>>(message.data, {})
  const parts = Array.isArray(data.parts) ? data.parts : []
  if (parts.length === 0 && message.searchable_text) {
    return [
      {
        id: `${message.id}:block:0`,
        type: 'text',
        text: message.searchable_text
      }
    ]
  }

  return parts.map((part, index) => {
    const payload: Record<string, unknown> =
      part && typeof part === 'object' ? (part as Record<string, unknown>) : { value: part }
    return {
      id: `${message.id}:block:${index}`,
      type: typeof payload.type === 'string' ? payload.type : 'unknown',
      text: typeof payload.text === 'string' ? payload.text : undefined,
      ...payload
    }
  })
}

async function getVersion(client: Awaited<ReturnType<typeof storageV2Database.getClient>>, table: string, id: string) {
  const result = await client.execute({
    sql: `SELECT version FROM ${table} WHERE id = ?`,
    args: [id]
  })
  return Number(result.rows[0]?.version ?? 1)
}

export class StorageV2DataApiAgentRuntimeMirrorService {
  async flushStrict(): Promise<void> {
    await this.mirrorNow()
  }

  async projectStorageToDataApiRuntime(): Promise<void> {
    const storageClient = await storageV2Database.getClient()
    const [
      agentsResult,
      sessionsResult,
      messagesResult,
      blocksResult,
      skillsResult,
      agentSkillsResult,
      channelsResult,
      tasksResult,
      channelTaskSubscriptionsResult,
      deletedAgentsResult,
      deletedSessionsResult,
      deletedMessagesResult,
      deletedSkillsResult,
      deletedChannelsResult,
      deletedTasksResult
    ] = await Promise.all([
      storageClient.execute(`
          SELECT id, type, name, description, instructions, model_id, plan_model_id, small_model_id,
                 mcps_json, configuration_json, sort_order, created_at, updated_at
          FROM agents
          WHERE deleted_at IS NULL
          ORDER BY sort_order ASC, created_at ASC, id ASC
        `),
      storageClient.execute(`
          SELECT id, agent_id, name, inherited_config_json, current_config_json,
                 sort_order, created_at, updated_at
          FROM agent_sessions
          WHERE deleted_at IS NULL
          ORDER BY agent_id ASC, sort_order ASC, created_at ASC, id ASC
        `),
      storageClient.execute(`
          SELECT m.id, c.session_id, m.role, m.status, m.model_id, m.token_usage_json,
                 m.metadata_json, m.created_at, m.updated_at
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.kind = 'agent_session'
            AND c.deleted_at IS NULL
            AND m.deleted_at IS NULL
          ORDER BY c.session_id ASC, m.created_at ASC, m.id ASC
        `),
      storageClient.execute(`
          SELECT b.id, b.message_id, b.type, b.text, b.payload_json, b.ordinal
          FROM message_blocks b
          INNER JOIN messages m ON m.id = b.message_id
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.kind = 'agent_session'
            AND c.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND b.deleted_at IS NULL
          ORDER BY b.message_id ASC, b.ordinal ASC, b.created_at ASC, b.id ASC
        `),
      storageClient.execute(`
          SELECT id, name, description, folder_name, source, source_url, namespace, author,
                 tags_json, content_hash, created_at, updated_at
          FROM skills
          WHERE deleted_at IS NULL
          ORDER BY name ASC, id ASC
        `),
      storageClient.execute(`
          SELECT agent_id, skill_id, enabled, created_at, updated_at
          FROM agent_skills
          ORDER BY agent_id ASC, skill_id ASC
        `),
      storageClient.execute(`
          SELECT id, type, name, agent_id, session_id, config_json, is_active,
                 active_chat_ids_json, permission_mode, created_at, updated_at
          FROM channels
          WHERE deleted_at IS NULL
          ORDER BY created_at ASC, id ASC
        `),
      storageClient.execute(`
          SELECT id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes,
                 next_run, last_run, last_result, status, created_at, updated_at
          FROM scheduled_tasks
          WHERE deleted_at IS NULL
          ORDER BY next_run ASC, created_at ASC, id ASC
        `),
      storageClient.execute(`
          SELECT channel_id, task_id
          FROM channel_task_subscriptions
          ORDER BY channel_id ASC, task_id ASC
        `),
      storageClient.execute(`
          SELECT id
          FROM agents
          WHERE deleted_at IS NOT NULL
        `),
      storageClient.execute(`
          SELECT id
          FROM agent_sessions
          WHERE deleted_at IS NOT NULL
        `),
      storageClient.execute(`
          SELECT m.id
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.kind = 'agent_session'
            AND m.deleted_at IS NOT NULL
        `),
      storageClient.execute(`
          SELECT id
          FROM skills
          WHERE deleted_at IS NOT NULL
        `),
      storageClient.execute(`
          SELECT id
          FROM channels
          WHERE deleted_at IS NOT NULL
        `),
      storageClient.execute(`
          SELECT id
          FROM scheduled_tasks
          WHERE deleted_at IS NOT NULL
        `)
    ])

    const agents = agentsResult.rows as unknown as StorageAgentRow[]
    const sessions = sessionsResult.rows as unknown as StorageSessionRow[]
    const messages = messagesResult.rows as unknown as StorageMessageRow[]
    const blocks = blocksResult.rows as unknown as StorageMessageBlockRow[]
    const skills = skillsResult.rows as unknown as StorageSkillRow[]
    const agentSkills = agentSkillsResult.rows as unknown as StorageAgentSkillRow[]
    const channels = channelsResult.rows as unknown as StorageChannelRow[]
    const tasks = tasksResult.rows as unknown as StorageScheduledTaskRow[]
    const channelTaskSubscriptions =
      channelTaskSubscriptionsResult.rows as unknown as StorageChannelTaskSubscriptionRow[]
    const deleted: StorageDeletedAgentRuntimeRows = {
      agentIds: uniqueStrings(deletedAgentsResult.rows as unknown as Array<{ id: unknown }>),
      sessionIds: uniqueStrings(deletedSessionsResult.rows as unknown as Array<{ id: unknown }>),
      messageIds: uniqueStrings(deletedMessagesResult.rows as unknown as Array<{ id: unknown }>),
      skillIds: uniqueStrings(deletedSkillsResult.rows as unknown as Array<{ id: unknown }>),
      channelIds: uniqueStrings(deletedChannelsResult.rows as unknown as Array<{ id: unknown }>),
      taskIds: uniqueStrings(deletedTasksResult.rows as unknown as Array<{ id: unknown }>)
    }
    const deletedCount =
      deleted.agentIds.length +
      deleted.sessionIds.length +
      deleted.messageIds.length +
      deleted.skillIds.length +
      deleted.channelIds.length +
      deleted.taskIds.length

    if (
      agents.length === 0 &&
      sessions.length === 0 &&
      messages.length === 0 &&
      skills.length === 0 &&
      agentSkills.length === 0 &&
      channels.length === 0 &&
      tasks.length === 0 &&
      channelTaskSubscriptions.length === 0 &&
      deletedCount === 0
    ) {
      return
    }

    await this.projectRowsToDataApi({
      agents,
      sessions,
      messages,
      blocks,
      skills,
      agentSkills,
      channels,
      tasks,
      channelTaskSubscriptions,
      deleted
    })
    logger.info('Projected Storage v2 agent runtime to DataApi tables', {
      agentCount: agents.length,
      sessionCount: sessions.length,
      messageCount: messages.length,
      skillCount: skills.length,
      agentSkillCount: agentSkills.length,
      channelCount: channels.length,
      taskCount: tasks.length,
      channelTaskSubscriptionCount: channelTaskSubscriptions.length,
      deletedCount
    })
  }

  private async mirrorNow(): Promise<void> {
    const db = application.get('DbService').getDb()
    const [agents, sessions, messages, skills, agentSkills, channels, taskRows, taskSubscriptions] = await Promise.all([
      db.all<DataApiAgentRow>(sql`
          SELECT
            id,
            type,
            name,
            description,
            instructions,
            model,
            plan_model,
            small_model,
            mcps,
            disabled_tools,
            configuration,
            ROW_NUMBER() OVER (ORDER BY order_key ASC, id ASC) - 1 AS sort_order,
            created_at,
            updated_at
          FROM agent
          WHERE deleted_at IS NULL
          ORDER BY order_key ASC, id ASC
        `),
      db.all<DataApiSessionRow>(sql`
          SELECT
            s.id,
            s.agent_id,
            a.type AS agent_type,
            s.name,
            s.description,
            w.path AS workspace_path,
            s.trace_id,
            a.instructions,
            a.model,
            a.plan_model,
            a.small_model,
            a.mcps,
            a.disabled_tools,
            a.configuration,
            ROW_NUMBER() OVER (PARTITION BY s.agent_id ORDER BY s.order_key ASC, s.id ASC) - 1 AS sort_order,
            s.created_at,
            s.updated_at
          FROM agent_session s
          INNER JOIN agent a ON a.id = s.agent_id AND a.deleted_at IS NULL
          LEFT JOIN agent_workspace w ON w.id = s.workspace_id
          ORDER BY s.agent_id ASC, s.order_key ASC, s.id ASC
        `),
      db.all<DataApiMessageRow>(sql`
          SELECT
            m.id,
            m.session_id,
            m.role,
            m.status,
            m.data,
            m.searchable_text,
            m.model_id,
            m.model_snapshot,
            m.stats,
            m.runtime_resume_token,
            m.created_at,
            m.updated_at
          FROM agent_session_message m
          INNER JOIN agent_session s ON s.id = m.session_id
          INNER JOIN agent a ON a.id = s.agent_id AND a.deleted_at IS NULL
          ORDER BY m.session_id ASC, m.created_at ASC, m.id ASC
        `),
      db.all<DataApiSkillRow>(sql`
          SELECT
            id,
            name,
            description,
            folder_name,
            source,
            source_url,
            namespace,
            author,
            tags,
            content_hash,
            is_enabled,
            created_at,
            updated_at
          FROM agent_global_skill
          ORDER BY created_at ASC, id ASC
        `),
      db.all<DataApiAgentSkillRow>(sql`
          SELECT agent_id, skill_id, is_enabled, created_at, updated_at
          FROM agent_skill
          ORDER BY agent_id ASC, skill_id ASC
        `),
      db.all<DataApiChannelRow>(sql`
          SELECT
            id,
            type,
            name,
            agent_id,
            session_id,
            workspace,
            config,
            is_active,
            active_chat_ids,
            permission_mode,
            created_at,
            updated_at
          FROM agent_channel
          ORDER BY created_at ASC, id ASC
        `),
      db.all<DataApiTaskRow>(sql`
          SELECT id, name, trigger, job_input_template, enabled, next_run, last_run, created_at, updated_at
          FROM job_schedule
          WHERE type = 'agent.task'
          ORDER BY created_at ASC, id ASC
        `),
      db.all<DataApiTaskSubscriptionRow>(sql`
          SELECT channel_id, task_id
          FROM agent_channel_task
          ORDER BY channel_id ASC, task_id ASC
        `)
    ])

    await this.mirrorAgents(agents)
    await this.mirrorSessions(sessions)
    await this.mirrorMessages(messages)
    await this.mirrorSkills(skills)
    await this.mirrorAgentSkills(agentSkills)
    await this.mirrorChannels(channels)
    await this.mirrorTasks(taskRows, taskSubscriptions)

    logger.debug('Mirrored DataApi agent runtime to Storage v2', {
      agentCount: agents.length,
      sessionCount: sessions.length,
      messageCount: messages.length,
      skillCount: skills.length,
      channelCount: channels.length,
      taskCount: taskRows.length
    })
  }

  private async projectRowsToDataApi(input: {
    agents: StorageAgentRow[]
    sessions: StorageSessionRow[]
    messages: StorageMessageRow[]
    blocks: StorageMessageBlockRow[]
    skills: StorageSkillRow[]
    agentSkills: StorageAgentSkillRow[]
    channels: StorageChannelRow[]
    tasks: StorageScheduledTaskRow[]
    channelTaskSubscriptions: StorageChannelTaskSubscriptionRow[]
    deleted: StorageDeletedAgentRuntimeRows
  }) {
    const dbService = application.get('DbService')
    const agentOrderKeys = generateOrderKeySequence(input.agents.length)
    const sessionOrderKeysById = this.buildSessionOrderKeys(input.sessions)
    const messageBlocksById = this.groupMessageBlocks(input.blocks)
    const agentIds = new Set(input.agents.map((agent) => agent.id))
    const sessionIds = new Set(
      input.sessions.filter((session) => agentIds.has(session.agent_id)).map((session) => session.id)
    )
    const skillIds = new Set(input.skills.map((skill) => skill.id))
    const taskIds = new Set(input.tasks.filter((task) => agentIds.has(task.agent_id)).map((task) => task.id))
    const channelIds = new Set(
      input.channels.filter((channel) => SUPPORTED_CHANNEL_TYPES.has(channel.type)).map((channel) => channel.id)
    )
    const modelRows = (await dbService.getDb().all(sql`SELECT id FROM user_model`)) as Array<{ id: string }>
    const modelIds = new Set(modelRows.map((row) => row.id))

    await dbService.withWriteTx(async (tx) => {
      await this.projectDeletedRowsTx(tx, input.deleted)

      for (const [index, agent] of input.agents.entries()) {
        await this.projectAgentTx(tx, agent, agentOrderKeys[index] ?? agentOrderKeys.at(-1) ?? 'a0', modelIds)
      }

      for (const skill of input.skills) {
        await this.projectSkillTx(tx, skill)
      }

      for (const session of input.sessions) {
        if (!agentIds.has(session.agent_id)) continue
        await this.projectSessionTx(tx, session, sessionOrderKeysById.get(session.id) ?? 'a0')
      }

      for (const message of input.messages) {
        if (!sessionIds.has(message.session_id)) continue
        await this.projectMessageTx(tx, message, messageBlocksById.get(message.id) ?? [], modelIds)
      }

      await this.replaceAgentSkillsTx(tx, input.agentSkills, agentIds, skillIds)

      for (const channel of input.channels) {
        await this.projectChannelTx(tx, channel, agentIds, sessionIds)
      }

      for (const task of input.tasks) {
        if (!agentIds.has(task.agent_id)) continue
        await this.projectScheduledTaskTx(tx, task)
      }

      await this.replaceChannelTaskSubscriptionsTx(tx, input.channelTaskSubscriptions, channelIds, taskIds)
    })
  }

  private buildSessionOrderKeys(sessions: StorageSessionRow[]) {
    const sessionsByAgent = new Map<string, StorageSessionRow[]>()
    for (const session of sessions) {
      const rows = sessionsByAgent.get(session.agent_id) ?? []
      rows.push(session)
      sessionsByAgent.set(session.agent_id, rows)
    }

    const orderKeys = new Map<string, string>()
    for (const rows of sessionsByAgent.values()) {
      const keys = generateOrderKeySequence(rows.length)
      rows.forEach((row, index) => {
        orderKeys.set(row.id, keys[index] ?? keys.at(-1) ?? 'a0')
      })
    }
    return orderKeys
  }

  private groupMessageBlocks(blocks: StorageMessageBlockRow[]) {
    const blocksById = new Map<string, StorageMessageBlockRow[]>()
    for (const block of blocks) {
      const rows = blocksById.get(block.message_id) ?? []
      rows.push(block)
      blocksById.set(block.message_id, rows)
    }
    return blocksById
  }

  private idListSql(ids: readonly string[]) {
    return sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )
  }

  private async projectDeletedRowsTx(tx: DbOrTx, deleted: StorageDeletedAgentRuntimeRows): Promise<void> {
    if (deleted.messageIds.length > 0) {
      await tx.run(sql`
        DELETE FROM agent_session_message
        WHERE id IN (${this.idListSql(deleted.messageIds)})
      `)
    }

    if (deleted.sessionIds.length > 0) {
      const sessionIds = this.idListSql(deleted.sessionIds)

      await pinService.purgeForEntitiesTx(tx, 'session', deleted.sessionIds)
      await tx.run(sql`
        DELETE FROM agent_workspace
        WHERE type = 'system'
          AND id IN (
            SELECT workspace_id
            FROM agent_session
            WHERE id IN (${sessionIds})
          )
      `)
      await tx.run(sql`
        DELETE FROM agent_session
        WHERE id IN (${sessionIds})
      `)
    }

    if (deleted.channelIds.length > 0) {
      await tx.run(sql`
        DELETE FROM agent_channel
        WHERE id IN (${this.idListSql(deleted.channelIds)})
      `)
    }

    if (deleted.taskIds.length > 0) {
      await tx.run(sql`
        DELETE FROM agent_channel_task
        WHERE task_id IN (${this.idListSql(deleted.taskIds)})
      `)
      await tx.run(sql`
        DELETE FROM job_schedule
        WHERE id IN (${this.idListSql(deleted.taskIds)})
      `)
    }

    if (deleted.skillIds.length > 0) {
      await tx.run(sql`
        DELETE FROM agent_global_skill
        WHERE id IN (${this.idListSql(deleted.skillIds)})
      `)
    }

    if (deleted.agentIds.length > 0) {
      await pinService.purgeForEntitiesTx(tx, 'agent', deleted.agentIds)
      await tx.run(sql`
        DELETE FROM agent
        WHERE id IN (${this.idListSql(deleted.agentIds)})
      `)
    }
  }

  private async projectAgentTx(
    tx: DbOrTx,
    agent: StorageAgentRow,
    orderKey: string,
    modelIds: Set<string>
  ): Promise<void> {
    const configuration = asRecord(agent.configuration_json)
    const disabledTools = asStringArray(configuration.disabledTools)
    const createdAt = toEpochMs(agent.created_at)
    const updatedAt = toEpochMs(agent.updated_at, createdAt)

    await tx.run(sql`
      INSERT INTO agent (
        id, type, name, description, instructions, model, plan_model, small_model,
        mcps, disabled_tools, configuration, order_key, created_at, updated_at, deleted_at
      )
      VALUES (
        ${agent.id},
        ${agent.type || 'pi'},
        ${agent.name || agent.id},
        ${agent.description ?? ''},
        ${agent.instructions ?? 'You are a helpful assistant.'},
        ${this.modelOrNull(agent.model_id, modelIds)},
        ${this.modelOrNull(agent.plan_model_id, modelIds)},
        ${this.modelOrNull(agent.small_model_id, modelIds)},
        ${toJson(asStringArray(agent.mcps_json))},
        ${toJson(disabledTools)},
        ${toJson(configuration)},
        ${orderKey},
        ${createdAt},
        ${updatedAt},
        NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        description = excluded.description,
        instructions = excluded.instructions,
        model = excluded.model,
        plan_model = excluded.plan_model,
        small_model = excluded.small_model,
        mcps = excluded.mcps,
        disabled_tools = excluded.disabled_tools,
        configuration = excluded.configuration,
        order_key = excluded.order_key,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `)
  }

  private async projectSkillTx(tx: DbOrTx, skill: StorageSkillRow): Promise<void> {
    const createdAt = toEpochMs(skill.created_at)
    const updatedAt = toEpochMs(skill.updated_at, createdAt)
    await tx.run(sql`
      INSERT INTO agent_global_skill (
        id, name, description, folder_name, source, source_url, namespace, author,
        tags, content_hash, is_enabled, created_at, updated_at
      )
      VALUES (
        ${skill.id},
        ${skill.name || skill.id},
        ${skill.description},
        ${skill.folder_name || skill.id},
        ${skill.source || 'local'},
        ${skill.source_url},
        ${skill.namespace},
        ${skill.author},
        ${toJson(asStringArray(skill.tags_json))},
        ${skill.content_hash ?? ''},
        0,
        ${createdAt},
        ${updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        folder_name = excluded.folder_name,
        source = excluded.source,
        source_url = excluded.source_url,
        namespace = excluded.namespace,
        author = excluded.author,
        tags = excluded.tags,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `)
  }

  private async projectSessionTx(tx: DbOrTx, session: StorageSessionRow, orderKey: string): Promise<void> {
    const currentConfig = asRecord(session.current_config_json)
    const inheritedConfig = asRecord(session.inherited_config_json)
    const configuration = asRecord(currentConfig.configuration ?? inheritedConfig)
    const workspacePath =
      optionalString(currentConfig.workspacePath) ??
      firstString(currentConfig.accessiblePaths) ??
      firstString(currentConfig.accessible_paths)
    const workspaceId = await this.ensureWorkspaceTx(tx, session.id, workspacePath)
    const createdAt = toEpochMs(session.created_at)
    const updatedAt = toEpochMs(session.updated_at, createdAt)

    await tx.run(sql`
      INSERT INTO agent_session (
        id, agent_id, name, description, workspace_id, trace_id, order_key, created_at, updated_at
      )
      VALUES (
        ${session.id},
        ${session.agent_id},
        ${session.name || session.id},
        ${optionalString(currentConfig.description) ?? ''},
        ${workspaceId},
        ${optionalString(configuration.traceId)},
        ${orderKey},
        ${createdAt},
        ${updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        agent_id = excluded.agent_id,
        name = excluded.name,
        description = excluded.description,
        workspace_id = excluded.workspace_id,
        trace_id = excluded.trace_id,
        order_key = excluded.order_key,
        updated_at = excluded.updated_at
    `)
  }

  private async ensureWorkspaceTx(tx: DbOrTx, sessionId: string, workspacePath: string | null): Promise<string> {
    const systemRoot = application.getPath('feature.agents.workspaces')
    const resolvedPath = workspacePath ?? path.join(systemRoot, sessionId)
    const [existing] = (await tx.all(sql`
      SELECT id FROM agent_workspace WHERE path = ${resolvedPath} LIMIT 1
    `)) as Array<{ id: string }>

    await fs.mkdir(resolvedPath, { recursive: true })
    if (existing?.id) return existing.id

    const id = randomUUID()
    const type = isPathInsideOrEqual(resolvedPath, systemRoot) ? 'system' : 'user'
    const [orderKey] = generateOrderKeySequence(1)
    await tx.run(sql`
      INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
      VALUES (
        ${id},
        ${path.basename(resolvedPath) || resolvedPath},
        ${resolvedPath},
        ${type},
        ${orderKey ?? 'a0'},
        ${Date.now()},
        ${Date.now()}
      )
    `)
    return id
  }

  private async projectMessageTx(
    tx: DbOrTx,
    message: StorageMessageRow,
    blocks: StorageMessageBlockRow[],
    modelIds: Set<string>
  ): Promise<void> {
    const metadata = asRecord(message.metadata_json)
    const metadataData = metadata.data
    const parts = blocks.map((block) => {
      const payload = asRecord(block.payload_json)
      return Object.keys(payload).length > 0
        ? payload
        : {
            type: block.type || 'text',
            text: block.text ?? ''
          }
    })
    const data =
      metadataData && typeof metadataData === 'object' && !Array.isArray(metadataData) ? metadataData : { parts }
    const createdAt = toEpochMs(message.created_at)
    const updatedAt = toEpochMs(message.updated_at, createdAt)

    await tx.run(sql`
      INSERT INTO agent_session_message (
        id, session_id, role, data, status, model_id, model_snapshot, stats,
        runtime_resume_token, created_at, updated_at
      )
      VALUES (
        ${message.id},
        ${message.session_id},
        ${message.role || 'assistant'},
        ${toJson(data)},
        ${message.status ?? 'success'},
        ${this.modelOrNull(message.model_id, modelIds)},
        ${toJson(metadata.modelSnapshot ?? null)},
        ${toJson(parseJson(message.token_usage_json, null))},
        ${optionalString(metadata.runtimeResumeToken)},
        ${createdAt},
        ${updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        role = excluded.role,
        data = excluded.data,
        status = excluded.status,
        model_id = excluded.model_id,
        model_snapshot = excluded.model_snapshot,
        stats = excluded.stats,
        runtime_resume_token = excluded.runtime_resume_token,
        updated_at = excluded.updated_at
    `)
  }

  private async projectAgentSkillTx(tx: DbOrTx, row: StorageAgentSkillRow): Promise<void> {
    await tx.run(sql`
      INSERT INTO agent_skill (agent_id, skill_id, is_enabled, created_at, updated_at)
      VALUES (
        ${row.agent_id},
        ${row.skill_id},
        ${asBoolean(row.enabled) ? 1 : 0},
        ${toEpochMs(row.created_at)},
        ${toEpochMs(row.updated_at)}
      )
      ON CONFLICT(agent_id, skill_id) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        updated_at = excluded.updated_at
    `)
  }

  private async replaceAgentSkillsTx(
    tx: DbOrTx,
    rows: StorageAgentSkillRow[],
    agentIds: Set<string>,
    skillIds: Set<string>
  ): Promise<void> {
    await tx.run(sql`DELETE FROM agent_skill`)
    for (const row of rows) {
      if (!agentIds.has(row.agent_id) || !skillIds.has(row.skill_id)) continue
      await this.projectAgentSkillTx(tx, row)
    }
  }

  private async projectChannelTx(
    tx: DbOrTx,
    channel: StorageChannelRow,
    agentIds: Set<string>,
    sessionIds: Set<string>
  ): Promise<void> {
    if (!SUPPORTED_CHANNEL_TYPES.has(channel.type)) return

    const restoredConfig = await this.restoreChannelConfig(channel)
    const workspace = asRecord(restoredConfig.workspace)
    delete restoredConfig.workspace
    delete restoredConfig.type

    const permissionMode =
      channel.permission_mode && SUPPORTED_PERMISSION_MODES.has(channel.permission_mode)
        ? channel.permission_mode
        : null
    const createdAt = toEpochMs(channel.created_at)
    const updatedAt = toEpochMs(channel.updated_at, createdAt)

    await tx.run(sql`
      INSERT INTO agent_channel (
        id, type, name, agent_id, session_id, workspace, config, is_active,
        active_chat_ids, permission_mode, created_at, updated_at
      )
      VALUES (
        ${channel.id},
        ${channel.type},
        ${channel.name || channel.type},
        ${channel.agent_id && agentIds.has(channel.agent_id) ? channel.agent_id : null},
        ${channel.session_id && sessionIds.has(channel.session_id) ? channel.session_id : null},
        ${toJson(Object.keys(workspace).length > 0 ? workspace : { type: 'system' })},
        ${toJson(restoredConfig)},
        ${asBoolean(channel.is_active) ? 1 : 0},
        ${toJson(asStringArray(channel.active_chat_ids_json))},
        ${permissionMode},
        ${createdAt},
        ${updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        agent_id = excluded.agent_id,
        session_id = excluded.session_id,
        workspace = excluded.workspace,
        config = excluded.config,
        is_active = excluded.is_active,
        active_chat_ids = excluded.active_chat_ids,
        permission_mode = excluded.permission_mode,
        updated_at = excluded.updated_at
    `)
  }

  private async projectScheduledTaskTx(tx: DbOrTx, task: StorageScheduledTaskRow): Promise<void> {
    const createdAt = toEpochMs(task.created_at)
    const updatedAt = toEpochMs(task.updated_at, createdAt)
    const timeoutMinutes = Math.max(1, toInteger(task.timeout_minutes, 2))

    await tx.run(sql`
      INSERT INTO job_schedule (
        id, type, name, trigger, job_input_template, enabled,
        next_run, last_run, catch_up_policy, metadata, created_at, updated_at
      )
      VALUES (
        ${task.id},
        'agent.task',
        ${task.name || task.id},
        ${toJson(this.buildTaskTrigger(task))},
        ${toJson({
          agentId: task.agent_id,
          prompt: task.prompt || '',
          timeoutMinutes,
          workspace: { type: 'system' }
        })},
        ${task.status === 'paused' ? 0 : 1},
        ${toEpochMsOrNull(task.next_run)},
        ${toEpochMsOrNull(task.last_run)},
        ${toJson({ kind: 'skip-missed' })},
        ${toJson({
          storageV2Status: task.status ?? 'active',
          lastResult: parseJson(task.last_result, null)
        })},
        ${createdAt},
        ${updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        trigger = excluded.trigger,
        job_input_template = excluded.job_input_template,
        enabled = excluded.enabled,
        next_run = excluded.next_run,
        last_run = excluded.last_run,
        catch_up_policy = excluded.catch_up_policy,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `)
  }

  private async projectChannelTaskSubscriptionTx(tx: DbOrTx, row: StorageChannelTaskSubscriptionRow): Promise<void> {
    await tx.run(sql`
      INSERT INTO agent_channel_task (channel_id, task_id)
      VALUES (${row.channel_id}, ${row.task_id})
      ON CONFLICT(channel_id, task_id) DO NOTHING
    `)
  }

  private async replaceChannelTaskSubscriptionsTx(
    tx: DbOrTx,
    rows: StorageChannelTaskSubscriptionRow[],
    channelIds: Set<string>,
    taskIds: Set<string>
  ): Promise<void> {
    await tx.run(sql`DELETE FROM agent_channel_task`)
    for (const row of rows) {
      if (!channelIds.has(row.channel_id) || !taskIds.has(row.task_id)) continue
      await this.projectChannelTaskSubscriptionTx(tx, row)
    }
  }

  private buildTaskTrigger(task: StorageScheduledTaskRow) {
    if (task.schedule_type === 'cron' && task.schedule_value) {
      return {
        kind: 'cron',
        expr: task.schedule_value
      }
    }

    if (task.schedule_type === 'interval') {
      const ms = toInteger(task.schedule_value, 60_000)
      return {
        kind: 'interval',
        ms: Math.max(1, ms)
      }
    }

    return {
      kind: 'once',
      at: toEpochMsOrNull(task.schedule_value) ?? Date.now()
    }
  }

  private async restoreChannelConfig(channel: StorageChannelRow): Promise<Record<string, unknown>> {
    const config = asRecord(channel.config_json)
    const restoredConfig = { ...config }

    for (const key of CHANNEL_SECRET_KEYS) {
      const refKey = `${key}_secret_ref`
      const secretRef = restoredConfig[refKey]
      if (typeof secretRef !== 'string' || !secretRef) continue

      const secret = await storageV2SecretVaultService.getSecret(secretRef)
      if (secret) {
        restoredConfig[key] = secret
      } else {
        logger.warn('Missing Storage v2 channel secret during DataApi projection', {
          channelId: channel.id,
          secretKey: key
        })
      }
      delete restoredConfig[refKey]
    }

    return restoredConfig
  }

  private modelOrNull(modelId: string | null | undefined, modelIds: Set<string>) {
    return modelId && modelIds.has(modelId) ? modelId : null
  }

  private async mirrorAgents(agents: DataApiAgentRow[]) {
    for (const agent of agents) {
      const configuration = {
        ...asRecord(agent.configuration),
        disabledTools: asStringArray(agent.disabled_tools)
      }
      await storageV2AgentRuntimeWriteService.upsertAgent({
        id: agent.id,
        type: agent.type,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        model: agent.model,
        plan_model: agent.plan_model,
        small_model: agent.small_model,
        accessible_paths: [],
        mcps: asStringArray(agent.mcps),
        allowed_tools: [],
        configuration,
        sort_order: agent.sort_order,
        created_at: toIsoTimestamp(agent.created_at),
        updated_at: toIsoTimestamp(agent.updated_at)
      })
    }
  }

  private async mirrorSessions(sessions: DataApiSessionRow[]) {
    for (const session of sessions) {
      const configuration = {
        ...asRecord(session.configuration),
        disabledTools: asStringArray(session.disabled_tools),
        traceId: session.trace_id ?? undefined,
        workspacePath: session.workspace_path ?? undefined
      }
      await storageV2AgentRuntimeWriteService.upsertAgentSession({
        id: session.id,
        agent_id: session.agent_id,
        agent_type: session.agent_type,
        name: session.name,
        description: session.description,
        accessible_paths: toJson(session.workspace_path ? [session.workspace_path] : []),
        instructions: session.instructions,
        model: session.model ?? '',
        plan_model: session.plan_model,
        small_model: session.small_model,
        mcps: toJson(asStringArray(session.mcps)),
        allowed_tools: toJson([]),
        slash_commands: toJson([]),
        configuration: toJson(configuration),
        sort_order: session.sort_order,
        created_at: toIsoTimestamp(session.created_at),
        updated_at: toIsoTimestamp(session.updated_at)
      })
    }
  }

  private async mirrorMessages(messages: DataApiMessageRow[]) {
    for (const message of messages) {
      const conversationId = `agent-session:${message.session_id}`
      const createdAt = toIsoTimestamp(message.created_at)
      const updatedAt = toIsoTimestamp(message.updated_at, createdAt)
      const blocks = normalizeMessageBlocks(message)

      await storageV2ConversationRepository.upsertMessage(conversationId, {
        id: message.id,
        role: message.role,
        status: message.status,
        modelId: message.model_id,
        usage: parseJson(message.stats, null),
        metadata: {
          source: 'agent_session_message',
          modelSnapshot: parseJson(message.model_snapshot, null),
          runtimeResumeToken: message.runtime_resume_token,
          data: parseJson(message.data, {})
        },
        createdAt,
        updatedAt,
        blocks
      })
      await storageV2ConversationRepository.upsertMessageBlocks(message.id, blocks, { pruneMissing: true })
    }
  }

  private async mirrorSkills(skills: DataApiSkillRow[]) {
    const client = await storageV2Database.getClient()

    await storageV2Database.withTransaction(client, async () => {
      for (const skill of skills) {
        const createdAt = toIsoTimestamp(skill.created_at)
        const updatedAt = toIsoTimestamp(skill.updated_at, createdAt)
        const result = await client.execute({
          sql: `
            INSERT INTO skills (
              id, name, description, folder_name, source, source_url, namespace, author,
              tags_json, content_hash, created_at, updated_at, deleted_at, version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              folder_name = excluded.folder_name,
              source = excluded.source,
              source_url = excluded.source_url,
              namespace = excluded.namespace,
              author = excluded.author,
              tags_json = excluded.tags_json,
              content_hash = excluded.content_hash,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              version = skills.version + 1
            WHERE
              skills.name IS NOT excluded.name OR
              skills.description IS NOT excluded.description OR
              skills.folder_name IS NOT excluded.folder_name OR
              skills.source IS NOT excluded.source OR
              skills.source_url IS NOT excluded.source_url OR
              skills.namespace IS NOT excluded.namespace OR
              skills.author IS NOT excluded.author OR
              skills.tags_json IS NOT excluded.tags_json OR
              skills.content_hash IS NOT excluded.content_hash OR
              skills.updated_at IS NOT excluded.updated_at OR
              skills.deleted_at IS NOT NULL
          `,
          args: [
            skill.id,
            skill.name,
            skill.description,
            skill.folder_name,
            skill.source,
            skill.source_url,
            skill.namespace,
            skill.author,
            toJson(asStringArray(skill.tags)),
            skill.content_hash ?? '',
            createdAt,
            updatedAt
          ]
        })

        if (Number(result.rowsAffected ?? 0) > 0) {
          await storageV2SyncLogService.recordChange({
            client,
            entityType: 'skill',
            entityId: skill.id,
            payload: { id: skill.id, name: skill.name, folderName: skill.folder_name },
            version: await getVersion(client, 'skills', skill.id)
          })
        }
      }
    })
  }

  private async mirrorAgentSkills(agentSkills: DataApiAgentSkillRow[]) {
    const client = await storageV2Database.getClient()

    await storageV2Database.withTransaction(client, async () => {
      for (const row of agentSkills) {
        const createdAt = toIsoTimestamp(row.created_at)
        const updatedAt = toIsoTimestamp(row.updated_at, createdAt)
        const enabled = asBoolean(row.is_enabled) ? 1 : 0
        const result = await client.execute({
          sql: `
            INSERT INTO agent_skills (agent_id, skill_id, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(agent_id, skill_id) DO UPDATE SET
              enabled = excluded.enabled,
              updated_at = excluded.updated_at
            WHERE
              agent_skills.enabled IS NOT excluded.enabled OR
              agent_skills.updated_at IS NOT excluded.updated_at
          `,
          args: [row.agent_id, row.skill_id, enabled, createdAt, updatedAt]
        })

        if (Number(result.rowsAffected ?? 0) > 0) {
          await storageV2SyncLogService.recordChange({
            client,
            entityType: 'agent_skill',
            entityId: encodeStorageV2CompositeEntityId([row.agent_id, row.skill_id]),
            payload: { agentId: row.agent_id, skillId: row.skill_id, enabled: Boolean(enabled) }
          })
        }
      }
    })
  }

  private async mirrorChannels(channels: DataApiChannelRow[]) {
    for (const channel of channels) {
      const config = {
        ...asRecord(channel.config),
        workspace: parseJson(channel.workspace, { type: 'system' })
      }
      await storageV2AgentRuntimeWriteService.upsertChannel({
        id: channel.id,
        type: channel.type,
        name: channel.name,
        agentId: channel.agent_id,
        sessionId: channel.session_id,
        config: config as never,
        isActive: asBoolean(channel.is_active),
        activeChatIds: asStringArray(channel.active_chat_ids),
        permissionMode: channel.permission_mode,
        createdAt: toIsoTimestamp(channel.created_at),
        updatedAt: toIsoTimestamp(channel.updated_at)
      })
    }
  }

  private async mirrorTasks(tasks: DataApiTaskRow[], taskSubscriptions: DataApiTaskSubscriptionRow[]) {
    const channelIdsByTask = new Map<string, string[]>()
    for (const subscription of taskSubscriptions) {
      const channelIds = channelIdsByTask.get(subscription.task_id) ?? []
      channelIds.push(subscription.channel_id)
      channelIdsByTask.set(subscription.task_id, channelIds)
    }

    for (const task of tasks) {
      const template = asRecord(task.job_input_template)
      const agentId = typeof template.agentId === 'string' ? template.agentId : ''
      const prompt = typeof template.prompt === 'string' ? template.prompt : ''
      if (!agentId || !prompt) continue

      const trigger = buildTriggerRuntimeFields(task.trigger)
      const updatedAt = toIsoTimestamp(task.updated_at)
      await storageV2AgentRuntimeWriteService.upsertScheduledTask(
        {
          id: task.id,
          agent_id: agentId,
          name: task.name ?? task.id,
          prompt,
          schedule_type: trigger.scheduleType,
          schedule_value: trigger.scheduleValue,
          timeout_minutes: typeof template.timeoutMinutes === 'number' ? template.timeoutMinutes : 2,
          next_run: task.next_run == null ? null : toIsoTimestamp(task.next_run),
          last_run: task.last_run == null ? null : toIsoTimestamp(task.last_run),
          last_result: null,
          status: asBoolean(task.enabled) ? 'active' : 'paused',
          created_at: toIsoTimestamp(task.created_at, updatedAt),
          updated_at: updatedAt
        },
        channelIdsByTask.get(task.id) ?? []
      )
    }
  }
}

export const storageV2DataApiAgentRuntimeMirrorService = new StorageV2DataApiAgentRuntimeMirrorService()
