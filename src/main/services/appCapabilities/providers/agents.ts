import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
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

function agentListOptions(input: any = {}) {
  const { limit, offset, ...rest } = input ?? {}
  return {
    ...rest,
    limit: normalizeListLimit(limit),
    offset: normalizeOffset(offset)
  }
}

async function listAgentTasks(input: any = {}) {
  const options = agentListOptions(input)
  const agentId = typeof input?.agentId === 'string' && input.agentId ? input.agentId : undefined

  if (agentId) {
    return agentTaskService.listTasks(agentId, options)
  }

  const { agents } = await listAgentsWithStorageV2Recovery({ limit: MAX_AGENT_CAPABILITY_LIST_LIMIT })
  const taskGroups = await Promise.all(agents.map((agent) => agentTaskService.listTasks(agent.id, options)))
  const tasks = taskGroups.flatMap((group) => group.tasks)
  const offset = options.offset ?? 0
  const limit = options.limit ?? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT

  return {
    tasks: tasks.slice(offset, offset + limit),
    total: tasks.length
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
        okResult('Agent models listed', await modelsService.getModels(agentListOptions(input)))
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
        const agent = await getAgentWithStorageV2Recovery(String(input?.agentId))
        if (!agent) throw new Error(`Agent not found: ${input?.agentId}`)
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
          type: { type: 'string', default: 'claude-code' },
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'string' },
          model: { type: 'string' },
          plan_model: { type: 'string' },
          small_model: { type: 'string' },
          accessible_paths: { type: 'array', items: { type: 'string' } },
          configuration: { type: 'object', additionalProperties: true }
        },
        required: ['name', 'model']
      },
      risk: 'write',
      permissions: ['agents.write'],
      sideEffects: ['database.write', 'filesystem.write'],
      tags: ['agents', 'create'],
      execute: async (input: any) => {
        const agent = await createAgentWithStorageV2Recovery({
          ...input,
          type: input?.type || 'claude-code'
        })
        const session = await agentSessionService
          .createSession({ agentId: agent.id, name: input?.sessionName || 'Default session' })
          .catch(() => null)
        return {
          ok: true,
          summary: `Agent created: ${agent.name}`,
          data: sanitizeForAgent({ agent, defaultSession: session })
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
          offset: { type: 'number', description: 'Pagination offset' }
        }
      },
      risk: 'read',
      tags: ['agents', 'sessions', 'list'],
      execute: async (input: any) =>
        okResult(
          'Agent sessions listed',
          sanitizeForAgent(
            await agentSessionService.listByCursor({
              agentId: input?.agentId,
              limit: normalizeListLimit(input?.limit)
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
          description: { type: 'string' },
          instructions: { type: 'string' },
          model: { type: 'string' }
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
          agentId: String(agentId),
          name: sessionInput.name || 'New session',
          description: sessionInput.description
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
          limit: { type: 'number', description: 'Maximum tasks to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' }
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
        const task = await agentTaskService.createTask(String(input?.agentId), input?.task)
        return okResult('Agent task created', sanitizeForAgent(task))
      }
    }
  ]
}
