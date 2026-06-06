import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelsService: {
    getModels: vi.fn()
  },
  listAgentsWithStorageV2Recovery: vi.fn(),
  createAgentWithStorageV2Recovery: vi.fn(),
  getAgentWithStorageV2Recovery: vi.fn(),
  sessionService: {
    listSessions: vi.fn(),
    createSession: vi.fn()
  },
  taskService: {
    listAllTasks: vi.fn(),
    createTask: vi.fn()
  }
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: mocks.modelsService
}))

vi.mock('@main/services/agents/AgentStorageV2ReadThrough', () => ({
  listAgentsWithStorageV2Recovery: mocks.listAgentsWithStorageV2Recovery,
  createAgentWithStorageV2Recovery: mocks.createAgentWithStorageV2Recovery,
  getAgentWithStorageV2Recovery: mocks.getAgentWithStorageV2Recovery
}))

vi.mock('@main/services/agents/services', () => ({
  sessionService: mocks.sessionService,
  taskService: mocks.taskService
}))

vi.mock('../../utils', () => ({
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  sanitizeForAgent: (value: unknown) => value
}))

import { createAgentCapabilities } from '../agents'

function capability(id: string) {
  const item = createAgentCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('agent app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelsService.getModels.mockResolvedValue({ models: [], total: 0 })
    mocks.listAgentsWithStorageV2Recovery.mockResolvedValue({ agents: [], total: 0 })
    mocks.sessionService.listSessions.mockResolvedValue({ sessions: [], total: 0 })
    mocks.taskService.listAllTasks.mockResolvedValue({ tasks: [], total: 0 })
  })

  it('defaults agent list capabilities to bounded pages', async () => {
    await capability('agents.models.list').execute({}, { source: 'agent' })
    await capability('agents.list').execute({}, { source: 'agent' })
    await capability('agents.sessions.list').execute({ agentId: 'agent-1' }, { source: 'agent' })
    await capability('agents.tasks.list').execute({}, { source: 'agent' })

    expect(mocks.modelsService.getModels).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.sessionService.listSessions).toHaveBeenCalledWith('agent-1', {
      agentId: 'agent-1',
      limit: 50,
      offset: undefined
    })
    expect(mocks.taskService.listAllTasks).toHaveBeenCalledWith({ limit: 50, offset: undefined })
  })

  it('clamps unsafe agent list pagination while preserving filters', async () => {
    await capability('agents.models.list').execute(
      { providerType: 'openai', limit: 5000, offset: -2 },
      { source: 'agent' }
    )
    await capability('agents.list').execute(
      { sortBy: 'created_at', orderBy: 'desc', limit: 'bad', offset: '8.9' },
      { source: 'agent' }
    )
    await capability('agents.tasks.list').execute({ limit: 0, offset: Number.NaN }, { source: 'agent' })

    expect(mocks.modelsService.getModels).toHaveBeenCalledWith({
      providerType: 'openai',
      limit: 200,
      offset: 0
    })
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({
      sortBy: 'created_at',
      orderBy: 'desc',
      limit: 50,
      offset: 8
    })
    expect(mocks.taskService.listAllTasks).toHaveBeenCalledWith({ limit: 1, offset: undefined })
  })
})
