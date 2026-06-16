import { application } from '@application'
import { loggerService } from '@logger'
import { encodeStorageV2CompositeEntityId } from '@main/services/storageV2/SyncEntityId'
import { sql } from 'drizzle-orm'

import { storageV2AgentRuntimeWriteService } from './AgentRuntimeWriteService'
import { storageV2Database } from './StorageV2Database'
import { storageV2ConversationRepository } from './StorageV2Repositories'
import { storageV2SyncLogService } from './SyncLogService'

const logger = loggerService.withContext('StorageV2DataApiAgentRuntimeMirrorService')

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

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === '1'
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
