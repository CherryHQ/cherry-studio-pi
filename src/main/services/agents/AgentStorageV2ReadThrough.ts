import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { ListOptions } from '@shared/data/api/apiTypes'
import type { CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type {
  AgentPersistedMessage,
  CreateAgentRequest,
  CreateAgentResponse,
  CreateTaskRequest,
  GetAgentResponse,
  UpdateAgentRequest,
  UpdateAgentResponse
} from '@types'

type LegacyListOptions = Omit<ListOptions, 'sortBy'> & { sortBy?: string }

function normalizeListOptions(options: LegacyListOptions = {}): ListOptions {
  const sortBy =
    options.sortBy === 'createdAt' ||
    options.sortBy === 'updatedAt' ||
    options.sortBy === 'name' ||
    options.sortBy === 'orderKey'
      ? options.sortBy
      : undefined
  return {
    ...options,
    sortBy
  }
}

function normalizeCreateAgentRequest(form: CreateAgentRequest): CreateAgentDto {
  return {
    ...form,
    type: form.type || 'pi'
  } as CreateAgentDto
}

function normalizeUpdateAgentRequest(updates: UpdateAgentRequest): UpdateAgentDto {
  return updates as UpdateAgentDto
}

function isDataApiNotFoundError(error: unknown) {
  return error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND
}

export async function listAgentsWithStorageV2Recovery(options: LegacyListOptions = {}) {
  return agentService.listAgents(normalizeListOptions(options))
}

export async function createAgentWithStorageV2Recovery(form: CreateAgentRequest): Promise<CreateAgentResponse> {
  return (await agentService.createAgent(normalizeCreateAgentRequest(form))) as CreateAgentResponse
}

export async function getAgentWithStorageV2Recovery(id: string): Promise<GetAgentResponse | null> {
  return (await agentService.getAgent(id)) as GetAgentResponse | null
}

export async function updateAgentWithStorageV2Recovery(
  id: string,
  updates: UpdateAgentRequest
): Promise<UpdateAgentResponse | null> {
  return (await agentService.updateAgent(id, normalizeUpdateAgentRequest(updates))) as UpdateAgentResponse | null
}

export async function deleteAgentWithStorageV2Recovery(id: string): Promise<boolean> {
  return agentService.deleteAgent(id)
}

export async function createSessionWithStorageV2Recovery(agentId: string, form: { name?: string } = {}) {
  return agentSessionService.createSession({
    agentId,
    name: form.name || 'New session',
    workspace: { type: 'system' }
  })
}

export async function listSessionsWithStorageV2Recovery(agentId: string, options: LegacyListOptions = {}) {
  const result = await agentSessionService.listByCursor({ agentId, limit: options.limit })
  return { data: result.items, sessions: result.items, total: result.items.length, limit: options.limit, offset: 0 }
}

export async function getSessionWithStorageV2Recovery(_agentId: string, sessionId: string) {
  try {
    return await agentSessionService.getById(sessionId)
  } catch (error) {
    if (isDataApiNotFoundError(error)) return null
    throw error
  }
}

export async function createTaskWithStorageV2Recovery(agentId: string, task: CreateTaskRequest) {
  return agentTaskService.createTask(agentId, task)
}

export async function listTasksWithStorageV2Recovery(agentId: string, options: LegacyListOptions = {}) {
  return agentTaskService.listTasks(agentId, normalizeListOptions(options))
}

function extractMessageText(message: AgentSessionMessageEntity): string {
  const data = message.data as Record<string, unknown> | string | null
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return message.searchableText ?? ''

  const content = (data as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown; content?: unknown }).text ?? (part as { content?: unknown }).content
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  const text = (data as { text?: unknown }).text
  return typeof text === 'string' ? text : (message.searchableText ?? '')
}

function toPersistedMessage(message: AgentSessionMessageEntity): AgentPersistedMessage {
  const payload = message.data as unknown
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    'blocks' in payload &&
    Array.isArray((payload as { blocks?: unknown }).blocks)
  ) {
    return payload as AgentPersistedMessage
  }

  const text = extractMessageText(message)
  return {
    message: {
      id: message.id,
      role: message.role,
      content: text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      status: message.status,
      type: 'text'
    } as unknown as AgentPersistedMessage['message'],
    blocks: [
      {
        id: `${message.id}:text`,
        messageId: message.id,
        type: 'main_text',
        content: text,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        status: message.status
      } as AgentPersistedMessage['blocks'][number]
    ]
  }
}

export async function getAgentSessionHistoryWithStorageV2Recovery(sessionId: string): Promise<AgentPersistedMessage[]> {
  const page = await agentSessionMessageService.listSessionMessages(sessionId, { limit: 80 })
  return [...page.items].reverse().map(toPersistedMessage)
}
