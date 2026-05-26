import type {
  AddAgentForm,
  ApiModelsFilter,
  ApiModelsResponse,
  CreateAgentResponse,
  CreateAgentSessionResponse,
  CreateSessionForm,
  GetAgentResponse,
  GetAgentSessionResponse,
  ListAgentSessionsResponse,
  ListOptions,
  UpdateAgentForm,
  UpdateAgentResponse,
  UpdateSessionForm
} from '@types'
import type {
  CreateTaskRequest,
  ListTaskLogsResponse,
  ListTasksResponse,
  ScheduledTaskEntity,
  UpdateTaskRequest
} from '@types'
import {
  ApiModelsResponseSchema,
  CreateAgentResponseSchema,
  CreateAgentSessionResponseSchema,
  GetAgentResponseSchema,
  GetAgentSessionResponseSchema,
  ListAgentSessionsResponseSchema,
  type ListAgentsResponse,
  ListAgentsResponseSchema,
  ListTaskLogsResponseSchema,
  ListTasksResponseSchema,
  objectEntries,
  objectKeys,
  ScheduledTaskEntitySchema,
  UpdateAgentResponseSchema
} from '@types'

type ApiVersion = 'v1'

const processError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error) {
    return new Error(error.message || fallbackMessage, { cause: error })
  }
  return new Error(fallbackMessage, { cause: error })
}

export const DEFAULT_SESSION_PAGE_SIZE = 20

export class AgentIpcClient {
  private apiVersion: ApiVersion = 'v1'

  public agentPaths = {
    base: `/${this.apiVersion}/agents`,
    withId: (id: string) => `/${this.apiVersion}/agents/${id}`
  }

  public getSessionPaths = (agentId: string) => ({
    base: `/${this.apiVersion}/agents/${agentId}/sessions`,
    withId: (id: string) => `/${this.apiVersion}/agents/${agentId}/sessions/${id}`
  })

  public getSessionMessagesPaths = (agentId: string, sessionId: string) => ({
    base: `/${this.apiVersion}/agents/${agentId}/sessions/${sessionId}/messages`,
    withId: (id: number) => `/${this.apiVersion}/agents/${agentId}/sessions/${sessionId}/messages/${id}`
  })

  public channelPaths = {
    base: `/${this.apiVersion}/channels`,
    withId: (id: string) => `/${this.apiVersion}/channels/${id}`
  }

  public taskPaths = {
    base: `/${this.apiVersion}/tasks`,
    withId: (taskId: string) => `/${this.apiVersion}/tasks/${taskId}`,
    run: (taskId: string) => `/${this.apiVersion}/tasks/${taskId}/run`,
    logs: (taskId: string) => `/${this.apiVersion}/tasks/${taskId}/logs`
  }

  public getModelsPath = (props?: ApiModelsFilter) => {
    const base = `/${this.apiVersion}/models`
    if (!props) return base
    if (objectKeys(props).length > 0) {
      const params = objectEntries(props)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      return `${base}?${params}`
    }
    return base
  }

  public async reorderAgents(orderedIds: string[]): Promise<void> {
    try {
      await window.api.agent.reorderAgents(orderedIds)
    } catch (error) {
      throw processError(error, 'Failed to reorder agents.')
    }
  }

  public async listAgents(options?: ListOptions): Promise<ListAgentsResponse> {
    try {
      const result = ListAgentsResponseSchema.safeParse(await window.api.agent.listAgents(options))
      if (!result.success) throw new Error('Not a valid Agents array.')
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to list agents.')
    }
  }

  public async createAgent(form: AddAgentForm): Promise<CreateAgentResponse> {
    try {
      return CreateAgentResponseSchema.parse(await window.api.agent.createAgent(form))
    } catch (error) {
      throw processError(error, 'Failed to create agent.')
    }
  }

  public async getAgent(id: string): Promise<GetAgentResponse> {
    try {
      const data = GetAgentResponseSchema.parse(await window.api.agent.getAgent(id))
      if (data.id !== id) throw new Error('Agent ID mismatch in response')
      return data
    } catch (error) {
      throw processError(error, 'Failed to get agent.')
    }
  }

  public async deleteAgent(id: string): Promise<void> {
    try {
      await window.api.agent.deleteAgent(id)
    } catch (error) {
      throw processError(error, 'Failed to delete agent.')
    }
  }

  public async updateAgent(form: UpdateAgentForm): Promise<UpdateAgentResponse> {
    try {
      const data = UpdateAgentResponseSchema.parse(await window.api.agent.updateAgent(form))
      if (data.id !== form.id) throw new Error('Agent ID mismatch in response')
      return data
    } catch (error) {
      throw processError(error, 'Failed to updateAgent.')
    }
  }

  public async reorderSessions(agentId: string, orderedIds: string[]): Promise<void> {
    try {
      await window.api.agent.reorderSessions(agentId, orderedIds)
    } catch (error) {
      throw processError(error, 'Failed to reorder sessions.')
    }
  }

  public async listSessions(agentId: string, options?: ListOptions): Promise<ListAgentSessionsResponse> {
    try {
      const result = ListAgentSessionsResponseSchema.safeParse(await window.api.agent.listSessions(agentId, options))
      if (!result.success) throw new Error('Not a valid Sessions array.')
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to list sessions.')
    }
  }

  public async createSession(agentId: string, session: CreateSessionForm): Promise<CreateAgentSessionResponse> {
    try {
      return CreateAgentSessionResponseSchema.parse(await window.api.agent.createSession(agentId, session))
    } catch (error) {
      throw processError(error, 'Failed to add session.')
    }
  }

  public async getSession(agentId: string, sessionId: string): Promise<GetAgentSessionResponse> {
    try {
      const data = GetAgentSessionResponseSchema.parse(await window.api.agent.getSession(agentId, sessionId))
      if (sessionId !== data.id) throw new Error('Session ID mismatch in response')
      return data
    } catch (error) {
      throw processError(error, 'Failed to get session.')
    }
  }

  public async deleteSession(agentId: string, sessionId: string): Promise<void> {
    try {
      await window.api.agent.deleteSession(agentId, sessionId)
    } catch (error) {
      throw processError(error, 'Failed to delete session.')
    }
  }

  public async deleteSessionMessage(agentId: string, sessionId: string, messageId: number): Promise<void> {
    try {
      await window.api.agent.deleteSessionMessage(agentId, sessionId, messageId)
    } catch (error) {
      throw processError(error, 'Failed to delete session message.')
    }
  }

  public async updateSession(agentId: string, session: UpdateSessionForm): Promise<GetAgentSessionResponse> {
    try {
      const data = GetAgentSessionResponseSchema.parse(await window.api.agent.updateSession(agentId, session))
      if (session.id !== data.id) throw new Error('Session ID mismatch in response')
      return data
    } catch (error) {
      throw processError(error, 'Failed to update session.')
    }
  }

  public async getModels(props?: ApiModelsFilter): Promise<ApiModelsResponse> {
    try {
      return ApiModelsResponseSchema.parse(await window.api.agent.listModels(props))
    } catch (error) {
      throw processError(error, 'Failed to get models.')
    }
  }

  public async listTasks(options?: ListOptions): Promise<ListTasksResponse> {
    try {
      const result = ListTasksResponseSchema.safeParse(await window.api.agent.listTasks(options))
      if (!result.success) throw new Error('Not a valid Tasks response.')
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to list tasks.')
    }
  }

  public async createTask(agentId: string, task: CreateTaskRequest): Promise<ScheduledTaskEntity> {
    try {
      return ScheduledTaskEntitySchema.parse(await window.api.agent.createTask(agentId, task))
    } catch (error) {
      throw processError(error, 'Failed to create task.')
    }
  }

  public async getTask(taskId: string): Promise<ScheduledTaskEntity> {
    try {
      return ScheduledTaskEntitySchema.parse(await window.api.agent.getTask(taskId))
    } catch (error) {
      throw processError(error, 'Failed to get task.')
    }
  }

  public async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity> {
    try {
      return ScheduledTaskEntitySchema.parse(await window.api.agent.updateTask(taskId, updates))
    } catch (error) {
      throw processError(error, 'Failed to update task.')
    }
  }

  public async deleteTask(taskId: string): Promise<void> {
    try {
      await window.api.agent.deleteTask(taskId)
    } catch (error) {
      throw processError(error, 'Failed to delete task.')
    }
  }

  public async runTask(taskId: string): Promise<void> {
    try {
      await window.api.agent.runTask(taskId)
    } catch (error) {
      throw processError(error, 'Failed to run task.')
    }
  }

  public async listChannels(filters?: { agent_id?: string; type?: string }): Promise<{ data: any[]; total: number }> {
    try {
      return await window.api.agent.listChannels(filters)
    } catch (error) {
      throw processError(error, 'Failed to list channels.')
    }
  }

  public async createChannel(data: Record<string, unknown>): Promise<any> {
    try {
      return await window.api.agent.createChannel(data)
    } catch (error) {
      throw processError(error, 'Failed to create channel.')
    }
  }

  public async updateChannel(id: string, data: Record<string, unknown>): Promise<any> {
    try {
      return await window.api.agent.updateChannel(id, data)
    } catch (error) {
      throw processError(error, 'Failed to update channel.')
    }
  }

  public async deleteChannel(id: string): Promise<void> {
    try {
      await window.api.agent.deleteChannel(id)
    } catch (error) {
      throw processError(error, 'Failed to delete channel.')
    }
  }

  public async getTaskLogs(taskId: string, options?: ListOptions): Promise<ListTaskLogsResponse> {
    try {
      const result = ListTaskLogsResponseSchema.safeParse(await window.api.agent.getTaskLogs(taskId, options))
      if (!result.success) throw new Error('Not a valid TaskLogs response.')
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to get task logs.')
    }
  }
}
