import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { modelsService } from '@main/apiServer/services/models'
import {
  createAgentWithStorageV2Recovery,
  getAgentWithStorageV2Recovery,
  listAgentsWithStorageV2Recovery
} from '@main/services/agents/AgentStorageV2ReadThrough'

import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const DEFAULT_AGENT_CAPABILITY_LIST_LIMIT = 50
const MAX_AGENT_CAPABILITY_LIST_LIMIT = 200

function normalizeListLimit(value: unknown) {
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT
      : Number(value ?? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_AGENT_CAPABILITY_LIST_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_AGENT_CAPABILITY_LIST_LIMIT))
}

function normalizeOffset(value: unknown) {
  const parsed = typeof value === 'string' && !value.trim() ? undefined : Number(value)
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.trunc(parsed))
}

function normalizeSortOrder(value: unknown) {
  return value === 'asc' || value === 'desc' ? value : undefined
}

function normalizeOptionalText(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const trimmed = String(value).trim()
    return trimmed || undefined
  }
  return undefined
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value)
  if (!text) throw new Error(`${label} is required`)
  return text
}

function normalizeOptionalTextArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => normalizeOptionalText(item)).filter((item): item is string => Boolean(item))
  return items.length > 0 ? Array.from(new Set(items)) : undefined
}

function normalizeOptionalObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function normalizeAgentType(value: unknown) {
  const type = normalizeOptionalText(value)
  if (!type) return 'pi'
  if (type === 'pi' || type === 'claude-code') return type
  throw new Error(`Unsupported agent type: ${type}`)
}

function agentListOptions(input: any = {}) {
  const { limit, offset, orderBy, sortOrder, ...rest } = input ?? {}
  const normalizedSortOrder = normalizeSortOrder(sortOrder) ?? normalizeSortOrder(orderBy)
  return {
    ...rest,
    ...(normalizedSortOrder ? { sortOrder: normalizedSortOrder } : {}),
    limit: normalizeListLimit(limit),
    offset: normalizeOffset(offset)
  }
}

async function listAgentTasks(input: any = {}) {
  const options = agentListOptions(input)
  const agentId = normalizeOptionalText(input?.agentId)

  if (agentId) {
    return agentTaskService.listTasks(agentId, {
      limit: options.limit,
      offset: options.offset,
      includeHeartbeat: options.includeHeartbeat
    })
  }

  const { agents } = await listAgentsWithStorageV2Recovery({ limit: MAX_AGENT_CAPABILITY_LIST_LIMIT })
  return await agentTaskService.listTasksAcrossAgents({
    agentIds: agents.map((agent) => agent.id),
    includeHeartbeat: options.includeHeartbeat,
    limit: options.limit ?? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT,
    offset: options.offset
  })
}

async function createDefaultAgentSession(
  agentId: string,
  name: string,
  workspace: { type: 'system' } | { type: 'user'; workspaceId: string }
) {
  try {
    const session = await agentSessionService.createSession({ agentId, name, workspace })
    return { session, warning: undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { session: null, warning: `Default session could not be created: ${message}` }
  }
}

export function createAgentCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'agents.models.list',
      domain: 'agents',
      kind: 'query',
      title: 'List agent models',
      description: 'List models available for agent creation or execution.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum models to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' },
          providerType: { type: 'string' }
        }
      },
      risk: 'read',
      tags: ['agents', 'models', 'llm'],
      execute: async (input: any) =>
        okResult('Agent models listed', sanitizeForAgent(await modelsService.getModels(agentListOptions(input))))
    },
    {
      id: 'agents.list',
      domain: 'agents',
      kind: 'query',
      title: 'List agents',
      description: 'List configured Pi agents.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum agents to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' },
          sortBy: { type: 'string' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          orderBy: { type: 'string', enum: ['asc', 'desc'] }
        }
      },
      risk: 'read',
      tags: ['agents', 'list'],
      execute: async (input: any) =>
        okResult('Agents listed', sanitizeForAgent(await listAgentsWithStorageV2Recovery(agentListOptions(input))))
    },
    {
      id: 'agents.get',
      domain: 'agents',
      kind: 'query',
      title: 'Get agent',
      description: 'Get one configured Pi agent by id.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' }
        },
        required: ['agentId']
      },
      risk: 'read',
      tags: ['agents', 'read'],
      execute: async (input: any) => {
        const agentId = normalizeRequiredText(input?.agentId, 'Agent id')
        const agent = await getAgentWithStorageV2Recovery(agentId)
        if (!agent) throw new Error(`Agent not found: ${agentId}`)
        return okResult('Agent read', sanitizeForAgent(agent))
      }
    },
    {
      id: 'agents.create',
      domain: 'agents',
      kind: 'command',
      title: 'Create agent',
      description: 'Create a Pi agent. The input is the same structured agent form used by the app.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', default: 'pi' },
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'string' },
          model: { type: 'string' },
          plan_model: { type: 'string' },
          planModel: { type: 'string' },
          small_model: { type: 'string' },
          smallModel: { type: 'string' },
          sessionName: { type: 'string', description: 'Optional default session name created with the agent' },
          accessible_paths: { type: 'array', items: { type: 'string' } },
          mcps: { type: 'array', items: { type: 'string' } },
          disabledTools: { type: 'array', items: { type: 'string' } },
          configuration: { type: 'object', additionalProperties: true }
        },
        required: ['name', 'model']
      },
      risk: 'write',
      permissions: ['agents.write'],
      sideEffects: ['database.write', 'filesystem.write'],
      tags: ['agents', 'create'],
      execute: async (input: any) => {
        const name = normalizeRequiredText(input?.name, 'Agent name')
        const model = normalizeRequiredText(input?.model, 'Agent model')
        const sessionName = normalizeOptionalText(input?.sessionName) || 'Default session'
        const accessiblePaths = normalizeOptionalTextArray(input?.accessible_paths)
        const sessionWorkspace = accessiblePaths?.[0]
          ? {
              type: 'user' as const,
              workspaceId: (await agentWorkspaceService.findOrCreateByPath(accessiblePaths[0])).id
            }
          : ({ type: 'system' } as const)
        const agent = await createAgentWithStorageV2Recovery({
          type: normalizeAgentType(input?.type),
          name,
          description: normalizeOptionalText(input?.description),
          instructions: normalizeOptionalText(input?.instructions),
          model,
          planModel: normalizeOptionalText(input?.planModel ?? input?.plan_model),
          smallModel: normalizeOptionalText(input?.smallModel ?? input?.small_model),
          mcps: normalizeOptionalTextArray(input?.mcps),
          disabledTools: normalizeOptionalTextArray(input?.disabledTools),
          configuration: normalizeOptionalObject(input?.configuration)
        })
        const { session, warning } = await createDefaultAgentSession(agent.id, sessionName, sessionWorkspace)
        return {
          ok: true,
          summary: warning ? `Agent created: ${agent.name}; ${warning}` : `Agent created: ${agent.name}`,
          data: sanitizeForAgent({
            agent,
            defaultSession: session,
            ...(warning ? { warnings: [warning] } : {})
          })
        }
      }
    },
    {
      id: 'agents.sessions.list',
      domain: 'agents',
      kind: 'query',
      title: 'List agent sessions',
      description: 'List sessions for an agent, or all sessions when agentId is omitted.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          limit: { type: 'number', description: 'Maximum sessions to return; defaults to 50 and is capped at 200' },
          cursor: { type: 'string', description: 'Opaque cursor returned by the previous page' }
        }
      },
      risk: 'read',
      tags: ['agents', 'sessions', 'list'],
      execute: async (input: any) =>
        okResult(
          'Agent sessions listed',
          sanitizeForAgent(
            await agentSessionService.listByCursor({
              agentId: normalizeOptionalText(input?.agentId),
              limit: normalizeListLimit(input?.limit),
              cursor: normalizeOptionalText(input?.cursor)
            })
          )
        )
    },
    {
      id: 'agents.session.create',
      domain: 'agents',
      kind: 'command',
      title: 'Create agent session',
      description: 'Create a new session for an agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['agentId']
      },
      risk: 'write',
      permissions: ['agents.sessions.write'],
      sideEffects: ['database.write'],
      tags: ['agents', 'sessions', 'create'],
      execute: async (input: any) => {
        const { agentId, ...sessionInput } = input ?? {}
        const session = await agentSessionService.createSession({
          agentId: normalizeRequiredText(agentId, 'Agent id'),
          name: normalizeOptionalText(sessionInput.name) || 'New session',
          description: normalizeOptionalText(sessionInput.description),
          workspace: { type: 'system' }
        })
        return okResult('Agent session created', sanitizeForAgent(session))
      }
    },
    {
      id: 'agents.tasks.list',
      domain: 'agents',
      kind: 'query',
      title: 'List agent tasks',
      description: 'List scheduled agent tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Optional agent id; omit to list tasks across all agents' },
          limit: { type: 'number', description: 'Maximum tasks to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' },
          includeHeartbeat: { type: 'boolean', description: 'Include internal heartbeat tasks; defaults to false' }
        }
      },
      risk: 'read',
      tags: ['agents', 'tasks', 'schedule'],
      execute: async (input: any) => okResult('Agent tasks listed', sanitizeForAgent(await listAgentTasks(input)))
    },
    {
      id: 'agents.task.create',
      domain: 'agents',
      kind: 'command',
      title: 'Create agent task',
      description: 'Create a scheduled task for an agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          task: { type: 'object', additionalProperties: true }
        },
        required: ['agentId', 'task']
      },
      risk: 'write',
      permissions: ['agents.tasks.write'],
      sideEffects: ['database.write'],
      tags: ['agents', 'tasks', 'schedule', 'create'],
      execute: async (input: any) => {
        const taskInput = input?.task
        if (!taskInput || typeof taskInput !== 'object' || Array.isArray(taskInput)) {
          throw new Error('Agent task is required')
        }
        const task = await agentTaskService.createTask(normalizeRequiredText(input?.agentId, 'Agent id'), taskInput)
        return okResult('Agent task created', sanitizeForAgent(task))
      }
    }
  ]
}
