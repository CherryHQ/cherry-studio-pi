/**
 * Agent domain entity types
 *
 * Types are derived from Zod entity schemas in `../api/schemas/*`.
 * This file re-exports inferred types for backward-compatible consumption
 * across main and renderer.
 */

import type { AgentConfiguration, AgentEntity, CreateAgentDto, UpdateAgentDto } from '../api/schemas/agents'
import type {
  AgentSessionEntity as AgentSessionEntityType,
  AgentSessionMessageEntity
} from '../api/schemas/agentSessions'

export type {
  AgentBase,
  AgentConfiguration,
  AgentEntity,
  AgentType,
  CreateAgentDto,
  CreateTaskDto as CreateTaskRequest,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  UpdateAgentDto,
  UpdateTaskDto as UpdateTaskRequest
} from '../api/schemas/agents'
export type { AgentSessionEntity, AgentSessionMessageEntity } from '../api/schemas/agentSessions'
export type { InstalledSkill } from '../api/schemas/skills'

export type MessageBlock = Record<string, unknown> & {
  id?: string
  messageId?: string
  type: string
  content?: unknown
  status?: string
  url?: string
}

export type AgentPersistedMessage = {
  message: Record<string, unknown> & {
    id?: string
    role?: 'user' | 'assistant' | 'system' | string
    content?: unknown
    createdAt?: string
    updatedAt?: string
    status?: string
    type?: string
    blocks?: string[]
  }
  blocks: MessageBlock[]
}

export type CreateAgentRequest = CreateAgentDto
export type CreateAgentResponse = AgentEntity
export type UpdateAgentRequest = UpdateAgentDto

export type GetAgentResponse = AgentEntity & {
  tools?: unknown[]
}

export type UpdateAgentResponse = GetAgentResponse

export type GetAgentSessionResponse = AgentSessionEntityType & {
  model?: string | null
  modelId?: string | null
  instructions?: string
  mcps?: string[]
  configuration?: AgentConfiguration
  tools?: unknown[]
  messages?: AgentSessionMessageEntity[]
  plugins?: Array<Record<string, unknown>>
}

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AgentThinkingConfig =
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' }
  | { type: 'adaptive'; display?: 'omitted' | 'summarized' }

export type CreateSessionMessageRequest = {
  content: string
  effort?: AgentEffort
  thinking?: AgentThinkingConfig
}
