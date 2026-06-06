import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelsService: {
    getModels: vi.fn()
  },
  listAgentsWithStorageV2Recovery: vi.fn(),
  createAgentWithStorageV2Recovery: vi.fn(),
  getAgentWithStorageV2Recovery: vi.fn(),
  agentSessionService: {
    listByCursor: vi.fn(),
    createSession: vi.fn()
  },
  agentTaskService: {
    listTasks: vi.fn(),
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

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: mocks.agentSessionService
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: mocks.agentTaskService
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
    mocks.agentSessionService.listByCursor.mockResolvedValue({ items: [], nextCursor: undefined })
    mocks.agentTaskService.listTasks.mockResolvedValue({ tasks: [], total: 0 })
  })

  it('defaults agent list capabilities to bounded pages', async () => {
    mocks.listAgentsWithStorageV2Recovery
      .mockResolvedValueOnce({ agents: [], total: 0 })
      .mockResolvedValueOnce({ agents: [{ id: 'agent-1' }], total: 1 })

    await capability('agents.models.list').execute({}, { source: 'agent' })
    await capability('agents.list').execute({}, { source: 'agent' })
    await capability('agents.sessions.list').execute({ agentId: 'agent-1' }, { source: 'agent' })
    await capability('agents.tasks.list').execute({}, { source: 'agent' })

    expect(mocks.modelsService.getModels).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.agentSessionService.listByCursor).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 50,
      cursor: undefined
    })
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({ limit: 200 })
    expect(mocks.agentTaskService.listTasks).toHaveBeenCalledWith('agent-1', { includeHeartbeat: undefined })
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
    await capability('agents.sessions.list').execute(
      { agentId: 'agent-1', cursor: 'cursor:one', limit: 5000 },
      { source: 'agent' }
    )
    await capability('agents.tasks.list').execute(
      { agentId: 'agent-1', limit: 0, offset: Number.NaN },
      { source: 'agent' }
    )

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
    expect(mocks.agentSessionService.listByCursor).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 200,
      cursor: 'cursor:one'
    })
    expect(mocks.agentTaskService.listTasks).toHaveBeenCalledWith('agent-1', {
      limit: 1,
      offset: undefined,
      includeHeartbeat: undefined
    })
  })

  it('paginates all agent tasks after merging tasks from each agent', async () => {
    mocks.listAgentsWithStorageV2Recovery.mockResolvedValueOnce({
      agents: [{ id: 'agent-a' }, { id: 'agent-b' }],
      total: 2
    })
    mocks.agentTaskService.listTasks
      .mockResolvedValueOnce({
        total: 2,
        tasks: [
          { id: 'old-a', createdAt: '2026-06-01T00:00:00.000Z' },
          { id: 'new-a', createdAt: '2026-06-03T00:00:00.000Z' }
        ]
      })
      .mockResolvedValueOnce({
        total: 1,
        tasks: [{ id: 'mid-b', createdAt: '2026-06-02T00:00:00.000Z' }]
      })

    const result = await capability('agents.tasks.list').execute({ limit: 1, offset: 1 }, { source: 'agent' })

    expect(mocks.agentTaskService.listTasks).toHaveBeenCalledWith('agent-a', { includeHeartbeat: undefined })
    expect(mocks.agentTaskService.listTasks).toHaveBeenCalledWith('agent-b', { includeHeartbeat: undefined })
    expect(result.data).toEqual({
      tasks: [{ id: 'mid-b', createdAt: '2026-06-02T00:00:00.000Z' }],
      total: 3
    })
  })
})
