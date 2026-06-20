import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { modelsService } from '@main/apiServer/services/models'
import {
  createAgentWithStorageV2Recovery,
  getAgentWithStorageV2Recovery,
  listAgentsWithStorageV2Recovery
} from '@main/services/agents/AgentStorageV2ReadThrough'
import type { CreateTaskDto } from '@shared/data/api/schemas/agents'

import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const DEFAULT_AGENT_CAPABILITY_LIST_LIMIT = 50
const MAX_AGENT_CAPABILITY_LIST_LIMIT = 200
const AGENT_LIST_SORT_BY_VALUES = new Set(['createdAt', 'updatedAt', 'name', 'orderKey'])
const AGENT_LIST_SORT_BY_ALIASES: Record<string, 'createdAt' | 'updatedAt' | 'name' | 'orderKey'> = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  order_key: 'orderKey'
}
const AGENT_LIST_LIMIT_TYPE_ERROR = '智能体列表数量必须是数字。'
const AGENT_LIST_OFFSET_TYPE_ERROR = '智能体列表偏移量必须是数字。'
const AGENT_INPUT_OBJECT_ERROR = '智能体能力的输入必须是对象。'
const AGENT_ABORT_ERROR = '智能体能力调用已取消。'
const AGENT_TASK_REQUIRED_ERROR = '智能体任务不能为空。'
const DEFAULT_SESSION_WARNING_PREFIX = '默认会话创建失败：'
const UNSUPPORTED_AGENT_TYPE_PREFIX = '不支持的智能体类型：'
const AGENT_NOT_FOUND_PREFIX = '未找到智能体：'
const TEXT_STRING_ERROR_SUFFIX = '必须是字符串。'
const TEXT_REQUIRED_ERROR_SUFFIX = '不能为空。'
const BOOLEAN_ERROR_SUFFIX = '必须是布尔值。'
const ARRAY_ERROR_SUFFIX = '必须是数组。'
const OBJECT_ERROR_SUFFIX = '必须是对象。'
const DEFAULT_TEXT_LABEL = '输入值'
const PROVIDER_TYPE_LABEL = '服务商类型'
const AGENT_SORT_FIELD_LABEL = '智能体排序字段'
const AGENT_SEARCH_QUERY_LABEL = '智能体搜索关键词'
const INCLUDE_HEARTBEAT_LABEL = '包含心跳任务'
const AGENT_ID_LABEL = '智能体 ID '
const AGENT_NAME_LABEL = '智能体名称'
const AGENT_MODEL_LABEL = '智能体模型'
const AGENT_SESSION_NAME_LABEL = '智能体会话名称'
const ACCESSIBLE_PATHS_LABEL = '可访问路径列表'
const ACCESSIBLE_PATH_LABEL = '可访问路径'
const AGENT_WORKSPACE_PATH_LABEL = '智能体工作目录'
const AGENT_TYPE_LABEL = '智能体类型'
const AGENT_DESCRIPTION_LABEL = '智能体描述'
const AGENT_INSTRUCTIONS_LABEL = '智能体提示词'
const AGENT_PLAN_MODEL_LABEL = '智能体规划模型'
const AGENT_SMALL_MODEL_LABEL = '智能体小模型'
const MCP_SERVER_IDS_LABEL = 'MCP 服务 ID 列表'
const MCP_SERVER_ID_LABEL = 'MCP 服务 ID '
const DISABLED_TOOLS_LABEL = '禁用工具列表'
const DISABLED_TOOL_LABEL = '禁用工具'
const AGENT_CONFIGURATION_LABEL = '智能体配置'
const AGENT_SESSION_CURSOR_LABEL = '智能体会话游标'
const SESSION_NAME_LABEL = '会话名称'
const SESSION_DESCRIPTION_LABEL = '会话描述'

function normalizeListLimit(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(AGENT_LIST_LIMIT_TYPE_ERROR)
  }
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT
      : Number(value ?? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_AGENT_CAPABILITY_LIST_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_AGENT_CAPABILITY_LIST_LIMIT))
}

function normalizeOffset(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(AGENT_LIST_OFFSET_TYPE_ERROR)
  }
  const parsed = typeof value === 'string' && !value.trim() ? undefined : Number(value)
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.trunc(parsed))
}

function normalizeSortOrder(value: unknown): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined
}

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(AGENT_INPUT_OBJECT_ERROR)
  return input as Record<string, unknown>
}

function throwIfAgentSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error(AGENT_ABORT_ERROR)
}

function normalizeOptionalText(value: unknown, label = DEFAULT_TEXT_LABEL) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  throw new Error(label + TEXT_STRING_ERROR_SUFFIX)
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(label + TEXT_REQUIRED_ERROR_SUFFIX)
  return text
}

function normalizeOptionalBoolean(value: unknown, label: string) {
  if (value === null || typeof value === 'undefined') return undefined
  if (typeof value !== 'boolean') throw new Error(label + BOOLEAN_ERROR_SUFFIX)
  return value
}

function normalizeAgentSortBy(value: unknown) {
  const sortBy = normalizeOptionalText(value, AGENT_SORT_FIELD_LABEL)
  if (!sortBy) return undefined
  if (AGENT_LIST_SORT_BY_ALIASES[sortBy]) return AGENT_LIST_SORT_BY_ALIASES[sortBy]
  if (!AGENT_LIST_SORT_BY_VALUES.has(sortBy)) return undefined
  return sortBy as 'createdAt' | 'updatedAt' | 'name' | 'orderKey'
}

function normalizeOptionalTextArray(value: unknown, label: string, itemLabel: string) {
  if (value === null || typeof value === 'undefined') return undefined
  if (!Array.isArray(value)) throw new Error(label + ARRAY_ERROR_SUFFIX)
  const items = value
    .map((item) => normalizeOptionalText(item, itemLabel))
    .filter((item): item is string => Boolean(item))
  return items.length > 0 ? Array.from(new Set(items)) : undefined
}

function normalizeOptionalObject(value: unknown, label: string) {
  if (value === null || typeof value === 'undefined') return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(label + OBJECT_ERROR_SUFFIX)
  return value as Record<string, unknown>
}

function normalizeAgentType(value: unknown) {
  const type = normalizeOptionalText(value, AGENT_TYPE_LABEL)
  if (!type) return 'pi'
  if (type === 'pi' || type === 'claude-code') return type
  throw new Error(UNSUPPORTED_AGENT_TYPE_PREFIX + type)
}

function baseListOptions(input: Record<string, unknown>) {
  const { limit, offset } = input
  return {
    limit: normalizeListLimit(limit),
    offset: normalizeOffset(offset)
  }
}

function modelListOptions(input: unknown) {
  const inputObject = normalizeInputObject(input)
  const providerType = normalizeOptionalText(inputObject.providerType, PROVIDER_TYPE_LABEL)
  return {
    ...baseListOptions(inputObject),
    ...(providerType ? { providerType } : {})
  }
}

function agentListOptions(input: unknown) {
  const inputObject = normalizeInputObject(input)
  const { orderBy, sortOrder } = inputObject
  const normalizedSortOrder = normalizeSortOrder(sortOrder) ?? normalizeSortOrder(orderBy)
  const sortBy = normalizeAgentSortBy(inputObject.sortBy)
  const search = normalizeOptionalText(inputObject.search, AGENT_SEARCH_QUERY_LABEL)
  return {
    ...baseListOptions(inputObject),
    ...(sortBy ? { sortBy } : {}),
    ...(search ? { search } : {}),
    ...(normalizedSortOrder ? { sortOrder: normalizedSortOrder } : {})
  }
}

function agentTaskListOptions(input: Record<string, unknown>) {
  return {
    ...baseListOptions(input),
    includeHeartbeat: normalizeOptionalBoolean(input.includeHeartbeat, INCLUDE_HEARTBEAT_LABEL)
  }
}

async function listAgentTasks(input: any = {}, signal?: AbortSignal) {
  const inputObject = normalizeInputObject(input)
  const options = agentTaskListOptions(inputObject)
  const agentId = normalizeOptionalText(inputObject.agentId, AGENT_ID_LABEL)
  throwIfAgentSignalAborted(signal)

  if (agentId) {
    const tasks = await agentTaskService.listTasks(agentId, {
      limit: options.limit,
      offset: options.offset,
      includeHeartbeat: options.includeHeartbeat
    })
    throwIfAgentSignalAborted(signal)
    return tasks
  }

  const tasks = await agentTaskService.listTasksAcrossAgents({
    includeHeartbeat: options.includeHeartbeat,
    limit: options.limit ?? DEFAULT_AGENT_CAPABILITY_LIST_LIMIT,
    offset: options.offset
  })
  throwIfAgentSignalAborted(signal)
  return tasks
}

async function createDefaultAgentSession(
  agentId: string,
  name: string,
  workspace: { type: 'system' } | { type: 'user'; workspaceId: string },
  signal?: AbortSignal
) {
  try {
    throwIfAgentSignalAborted(signal)
    const session = await agentSessionService.createSession({ agentId, name, workspace })
    throwIfAgentSignalAborted(signal)
    return { session, warning: undefined }
  } catch (error) {
    if (signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    return { session: null, warning: DEFAULT_SESSION_WARNING_PREFIX + message }
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
      execute: async (input: any, context) => {
        const options = modelListOptions(input)
        throwIfAgentSignalAborted(context.signal)
        const models = await modelsService.getModels(options)
        throwIfAgentSignalAborted(context.signal)
        return okResult('Agent models listed', sanitizeForAgent(models))
      }
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
      execute: async (input: any, context) => {
        const options = agentListOptions(input)
        throwIfAgentSignalAborted(context.signal)
        const agents = await listAgentsWithStorageV2Recovery(options)
        throwIfAgentSignalAborted(context.signal)
        return okResult('Agents listed', sanitizeForAgent(agents))
      }
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
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const agentId = normalizeRequiredText(inputObject.agentId, AGENT_ID_LABEL)
        throwIfAgentSignalAborted(context.signal)
        const agent = await getAgentWithStorageV2Recovery(agentId)
        throwIfAgentSignalAborted(context.signal)
        if (!agent) throw new Error(AGENT_NOT_FOUND_PREFIX + agentId)
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
          workspacePath: {
            type: 'string',
            description: 'Optional workspace path for the initial agent session'
          },
          workspace_path: {
            type: 'string',
            description: 'Alias for workspacePath'
          },
          accessible_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Legacy alias; the first path is used as the initial session workspace'
          },
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
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const name = normalizeRequiredText(inputObject.name, AGENT_NAME_LABEL)
        const model = normalizeRequiredText(inputObject.model, AGENT_MODEL_LABEL)
        const sessionName =
          normalizeOptionalText(inputObject.sessionName, AGENT_SESSION_NAME_LABEL) || 'Default session'
        const accessiblePaths = normalizeOptionalTextArray(
          inputObject.accessible_paths,
          ACCESSIBLE_PATHS_LABEL,
          ACCESSIBLE_PATH_LABEL
        )
        const workspacePath = normalizeOptionalText(
          inputObject.workspacePath ?? inputObject.workspace_path,
          AGENT_WORKSPACE_PATH_LABEL
        )
        const type = normalizeAgentType(inputObject.type)
        const description = normalizeOptionalText(inputObject.description, AGENT_DESCRIPTION_LABEL)
        const instructions = normalizeOptionalText(inputObject.instructions, AGENT_INSTRUCTIONS_LABEL)
        const planModel = normalizeOptionalText(inputObject.planModel ?? inputObject.plan_model, AGENT_PLAN_MODEL_LABEL)
        const smallModel = normalizeOptionalText(
          inputObject.smallModel ?? inputObject.small_model,
          AGENT_SMALL_MODEL_LABEL
        )
        const mcps = normalizeOptionalTextArray(inputObject.mcps, MCP_SERVER_IDS_LABEL, MCP_SERVER_ID_LABEL)
        const disabledTools = normalizeOptionalTextArray(
          inputObject.disabledTools,
          DISABLED_TOOLS_LABEL,
          DISABLED_TOOL_LABEL
        )
        const configuration = normalizeOptionalObject(inputObject.configuration, AGENT_CONFIGURATION_LABEL)
        const initialWorkspacePath = workspacePath ?? accessiblePaths?.[0]
        throwIfAgentSignalAborted(context.signal)
        const sessionWorkspace = initialWorkspacePath
          ? {
              type: 'user' as const,
              workspaceId: (await agentWorkspaceService.findOrCreateByPath(initialWorkspacePath)).id
            }
          : ({ type: 'system' } as const)
        throwIfAgentSignalAborted(context.signal)
        const agent = await createAgentWithStorageV2Recovery({
          type,
          name,
          description,
          instructions,
          model,
          planModel,
          smallModel,
          mcps,
          disabledTools,
          configuration
        })
        throwIfAgentSignalAborted(context.signal)
        const { session, warning } = await createDefaultAgentSession(
          agent.id,
          sessionName,
          sessionWorkspace,
          context.signal
        )
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
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const options = {
          agentId: normalizeOptionalText(inputObject.agentId, AGENT_ID_LABEL),
          limit: normalizeListLimit(inputObject.limit),
          cursor: normalizeOptionalText(inputObject.cursor, AGENT_SESSION_CURSOR_LABEL)
        }
        throwIfAgentSignalAborted(context.signal)
        const sessions = await agentSessionService.listByCursor(options)
        throwIfAgentSignalAborted(context.signal)
        return okResult('Agent sessions listed', sanitizeForAgent(sessions))
      }
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
      execute: async (input: any, context) => {
        const { agentId, ...sessionInput } = normalizeInputObject(input)
        const sessionPayload = {
          agentId: normalizeRequiredText(agentId, AGENT_ID_LABEL),
          name: normalizeOptionalText(sessionInput.name, SESSION_NAME_LABEL) || 'New session',
          description: normalizeOptionalText(sessionInput.description, SESSION_DESCRIPTION_LABEL),
          workspace: { type: 'system' as const }
        }
        throwIfAgentSignalAborted(context.signal)
        const session = await agentSessionService.createSession(sessionPayload)
        throwIfAgentSignalAborted(context.signal)
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
      execute: async (input: any, context) =>
        okResult('Agent tasks listed', sanitizeForAgent(await listAgentTasks(input, context.signal)))
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
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const taskInput = inputObject.task
        if (!taskInput || typeof taskInput !== 'object' || Array.isArray(taskInput)) {
          throw new Error(AGENT_TASK_REQUIRED_ERROR)
        }
        const agentId = normalizeRequiredText(inputObject.agentId, AGENT_ID_LABEL)
        throwIfAgentSignalAborted(context.signal)
        const task = await agentTaskService.createTask(agentId, taskInput as CreateTaskDto)
        throwIfAgentSignalAborted(context.signal)
        return okResult('Agent task created', sanitizeForAgent(task))
      }
    }
  ]
}
