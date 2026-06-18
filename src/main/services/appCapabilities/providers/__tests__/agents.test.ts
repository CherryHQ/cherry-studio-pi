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
  agentWorkspaceService: {
    findOrCreateByPath: vi.fn()
  },
  agentTaskService: {
    listTasks: vi.fn(),
    listTasksAcrossAgents: vi.fn(),
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

vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: mocks.agentWorkspaceService
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
    mocks.createAgentWithStorageV2Recovery.mockResolvedValue({ id: 'agent-1', name: 'Agent One' })
    mocks.getAgentWithStorageV2Recovery.mockResolvedValue({ id: 'agent-1', name: 'Agent One' })
    mocks.agentSessionService.listByCursor.mockResolvedValue({ items: [], nextCursor: undefined })
    mocks.agentSessionService.createSession.mockResolvedValue({ id: 'session-1' })
    mocks.agentWorkspaceService.findOrCreateByPath.mockResolvedValue({ id: 'workspace-1', path: '/tmp/work' })
    mocks.agentTaskService.listTasks.mockResolvedValue({ tasks: [], total: 0 })
    mocks.agentTaskService.listTasksAcrossAgents.mockResolvedValue({ tasks: [], total: 0 })
    mocks.agentTaskService.createTask.mockResolvedValue({ id: 'task-1' })
  })

  it('defaults agent list capabilities to bounded pages', async () => {
    mocks.listAgentsWithStorageV2Recovery.mockResolvedValueOnce({ agents: [], total: 0 })

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
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledTimes(1)
    expect(mocks.agentTaskService.listTasksAcrossAgents).toHaveBeenCalledWith({
      includeHeartbeat: undefined,
      limit: 50,
      offset: undefined
    })
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
      sortBy: 'createdAt',
      sortOrder: 'desc',
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

  it('prefers sortOrder over the legacy orderBy alias for agent list calls', async () => {
    await capability('agents.list').execute(
      { sortBy: 'name', sortOrder: 'asc', orderBy: 'desc', limit: 10 },
      { source: 'agent' }
    )

    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 10,
      offset: undefined
    })
  })

  it('passes only supported agent list filters to underlying services', async () => {
    await capability('agents.models.list').execute(
      { providerType: ' openai ', unknown: { nested: true }, limit: 25 },
      { source: 'agent' }
    )
    await capability('agents.list').execute(
      { search: ' research ', sortBy: 'updated_at', sortOrder: 'asc', unknown: 'ignored' },
      { source: 'agent' }
    )
    await capability('agents.tasks.list').execute(
      { includeHeartbeat: true, extra: 'ignored', limit: 10 },
      { source: 'agent' }
    )

    expect(mocks.modelsService.getModels).toHaveBeenCalledWith({
      providerType: 'openai',
      limit: 25,
      offset: undefined
    })
    expect(mocks.listAgentsWithStorageV2Recovery).toHaveBeenCalledWith({
      search: 'research',
      sortBy: 'updatedAt',
      sortOrder: 'asc',
      limit: 50,
      offset: undefined
    })
    expect(mocks.agentTaskService.listTasksAcrossAgents).toHaveBeenCalledWith({
      includeHeartbeat: true,
      limit: 10,
      offset: undefined
    })
  })

  it('rejects invalid typed agent list filters before service calls', async () => {
    await expect(capability('agents.models.list').execute({ providerType: 123 }, { source: 'agent' })).rejects.toThrow(
      'Provider type must be a string'
    )
    await expect(capability('agents.list').execute({ sortBy: 123 }, { source: 'agent' })).rejects.toThrow(
      'Agent sort field must be a string'
    )
    await expect(capability('agents.list').execute({ search: ['research'] }, { source: 'agent' })).rejects.toThrow(
      'Agent search query must be a string'
    )
    await expect(
      capability('agents.tasks.list').execute({ includeHeartbeat: 'true' }, { source: 'agent' })
    ).rejects.toThrow('Include heartbeat must be a boolean')
    await expect(capability('agents.list').execute([], { source: 'agent' })).rejects.toThrow(
      'Agent capability input must be an object'
    )

    expect(mocks.modelsService.getModels).not.toHaveBeenCalled()
    expect(mocks.listAgentsWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasks).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasksAcrossAgents).not.toHaveBeenCalled()
  })

  it('delegates all-agent task pagination to task storage without prefetching agents', async () => {
    mocks.agentTaskService.listTasksAcrossAgents.mockResolvedValueOnce({
      total: 3,
      tasks: [{ id: 'mid-b', createdAt: '2026-06-02T00:00:00.000Z' }]
    })

    const result = await capability('agents.tasks.list').execute({ limit: 1, offset: 1 }, { source: 'agent' })

    expect(mocks.listAgentsWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasksAcrossAgents).toHaveBeenCalledWith({
      includeHeartbeat: undefined,
      limit: 1,
      offset: 1
    })
    expect(result.data).toEqual({
      tasks: [{ id: 'mid-b', createdAt: '2026-06-02T00:00:00.000Z' }],
      total: 3
    })
  })

  it('normalizes agent identifiers and session inputs before dispatching service calls', async () => {
    await capability('agents.get').execute({ agentId: ' agent-1 ' }, { source: 'agent' })
    await capability('agents.sessions.list').execute(
      { agentId: ' agent-1 ', cursor: ' cursor:one ' },
      { source: 'agent' }
    )
    await capability('agents.session.create').execute(
      { agentId: ' agent-1 ', name: ' Research ', description: ' Explore docs ' },
      { source: 'agent' }
    )
    await capability('agents.tasks.list').execute({ agentId: ' agent-1 ' }, { source: 'agent' })
    await capability('agents.task.create').execute(
      { agentId: ' agent-1 ', task: { title: 'Check sync' } },
      { source: 'agent' }
    )

    expect(mocks.getAgentWithStorageV2Recovery).toHaveBeenCalledWith('agent-1')
    expect(mocks.agentSessionService.listByCursor).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 50,
      cursor: 'cursor:one'
    })
    expect(mocks.agentSessionService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'Research',
      description: 'Explore docs',
      workspace: { type: 'system' }
    })
    expect(mocks.agentTaskService.listTasks).toHaveBeenCalledWith('agent-1', {
      limit: 50,
      offset: undefined,
      includeHeartbeat: undefined
    })
    expect(mocks.agentTaskService.createTask).toHaveBeenCalledWith('agent-1', { title: 'Check sync' })
  })

  it('does not advertise unsupported session-level model or instruction fields', () => {
    const properties = capability('agents.session.create').inputSchema.properties ?? {}

    expect(properties).toHaveProperty('agentId')
    expect(properties).toHaveProperty('name')
    expect(properties).toHaveProperty('description')
    expect(properties).not.toHaveProperty('model')
    expect(properties).not.toHaveProperty('instructions')
  })

  it('treats blank optional agent filters as omitted', async () => {
    await capability('agents.sessions.list').execute({ agentId: '   ', cursor: '   ' }, { source: 'agent' })
    await capability('agents.tasks.list').execute({ agentId: '   ' }, { source: 'agent' })

    expect(mocks.agentSessionService.listByCursor).toHaveBeenCalledWith({
      agentId: undefined,
      limit: 50,
      cursor: undefined
    })
    expect(mocks.agentTaskService.listTasksAcrossAgents).toHaveBeenCalledWith({
      includeHeartbeat: undefined,
      limit: 50,
      offset: undefined
    })
  })

  it('normalizes app agent creation input to the data API shape', async () => {
    await capability('agents.create').execute(
      {
        name: ' Agent One ',
        model: ' model-1 ',
        type: ' claude-code ',
        sessionName: ' First task ',
        plan_model: ' planner-1 ',
        smallModel: ' small-1 ',
        accessible_paths: [' /tmp/work ', ''],
        mcps: [' docs ', 'docs'],
        disabledTools: [' Bash ', 'Bash'],
        configuration: { max_turns: 5 }
      },
      { source: 'agent' }
    )

    expect(mocks.createAgentWithStorageV2Recovery).toHaveBeenCalledWith({
      name: 'Agent One',
      model: 'model-1',
      type: 'claude-code',
      description: undefined,
      instructions: undefined,
      planModel: 'planner-1',
      smallModel: 'small-1',
      mcps: ['docs'],
      disabledTools: ['Bash'],
      configuration: { max_turns: 5 }
    })
    expect(mocks.agentWorkspaceService.findOrCreateByPath).toHaveBeenCalledWith('/tmp/work')
    expect(mocks.agentSessionService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'First task',
      workspace: { type: 'user', workspaceId: 'workspace-1' }
    })
  })

  it('accepts UI-style workspacePath when creating an initial agent session', async () => {
    await capability('agents.create').execute(
      {
        name: 'Agent One',
        model: 'model-1',
        workspacePath: ' /Users/me/project '
      },
      { source: 'agent' }
    )

    expect(mocks.agentWorkspaceService.findOrCreateByPath).toHaveBeenCalledWith('/Users/me/project')
    expect(mocks.agentSessionService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'Default session',
      workspace: { type: 'user', workspaceId: 'workspace-1' }
    })
  })

  it('prefers workspacePath over the legacy accessible_paths workspace alias', async () => {
    await capability('agents.create').execute(
      {
        name: 'Agent One',
        model: 'model-1',
        workspacePath: ' /Users/me/primary ',
        accessible_paths: [' /Users/me/legacy ']
      },
      { source: 'agent' }
    )

    expect(mocks.agentWorkspaceService.findOrCreateByPath).toHaveBeenCalledWith('/Users/me/primary')
  })

  it('defaults app-created agents to the Pi runtime', async () => {
    await capability('agents.create').execute({ name: ' Agent One ', model: ' model-1 ' }, { source: 'agent' })

    expect(mocks.createAgentWithStorageV2Recovery).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pi'
      })
    )
  })

  it('returns a warning when the default agent session cannot be created', async () => {
    mocks.agentSessionService.createSession.mockRejectedValueOnce(new Error('workspace unavailable'))

    const result = await capability('agents.create').execute(
      { name: 'Agent One', model: 'model-1' },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('Default session could not be created')
    expect(result.data).toMatchObject({
      agent: { id: 'agent-1', name: 'Agent One' },
      defaultSession: null,
      warnings: ['Default session could not be created: workspace unavailable']
    })
  })

  it('rejects empty required agent inputs before calling services', async () => {
    await expect(
      capability('agents.create').execute({ name: '   ', model: 'model-1' }, { source: 'agent' })
    ).rejects.toThrow('Agent name is required')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: '   ' }, { source: 'agent' })
    ).rejects.toThrow('Agent model is required')
    await expect(capability('agents.get').execute({ agentId: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Agent id is required'
    )
    await expect(capability('agents.session.create').execute({ agentId: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Agent id is required'
    )
    await expect(
      capability('agents.task.create').execute({ agentId: 'agent-1', task: [] }, { source: 'agent' })
    ).rejects.toThrow('Agent task is required')

    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.getAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.createTask).not.toHaveBeenCalled()
  })

  it('rejects invalid optional agent creation fields before writing', async () => {
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', accessible_paths: '/tmp/work' },
        { source: 'agent' }
      )
    ).rejects.toThrow('Accessible paths must be an array')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: 'model-1', mcps: 'docs' }, { source: 'agent' })
    ).rejects.toThrow('MCP server ids must be an array')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', disabledTools: 'Bash' },
        { source: 'agent' }
      )
    ).rejects.toThrow('Disabled tools must be an array')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', configuration: [] },
        { source: 'agent' }
      )
    ).rejects.toThrow('Agent configuration must be an object')

    expect(mocks.agentWorkspaceService.findOrCreateByPath).not.toHaveBeenCalled()
    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })

  it('rejects invalid agent text input shapes before side effects', async () => {
    await expect(capability('agents.get').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      'Agent id must be a string'
    )
    await expect(capability('agents.sessions.list').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      'Agent id must be a string'
    )
    await expect(capability('agents.tasks.list').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      'Agent id must be a string'
    )
    await expect(
      capability('agents.session.create').execute({ agentId: 'agent-1', name: ['Research'] }, { source: 'agent' })
    ).rejects.toThrow('Session name must be a string')
    await expect(
      capability('agents.session.create').execute(
        { agentId: 'agent-1', description: { text: 'Explore docs' } },
        { source: 'agent' }
      )
    ).rejects.toThrow('Session description must be a string')
    await expect(
      capability('agents.task.create').execute({ agentId: false, task: { title: 'Check sync' } }, { source: 'agent' })
    ).rejects.toThrow('Agent id must be a string')
    await expect(
      capability('agents.create').execute({ name: 123, model: 'model-1' }, { source: 'agent' })
    ).rejects.toThrow('Agent name must be a string')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: 123 }, { source: 'agent' })
    ).rejects.toThrow('Agent model must be a string')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', type: 123, accessible_paths: ['/tmp/work'] },
        { source: 'agent' }
      )
    ).rejects.toThrow('Agent type must be a string')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', accessible_paths: [123] },
        { source: 'agent' }
      )
    ).rejects.toThrow('Accessible path must be a string')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', workspacePath: { path: '/tmp/work' } },
        { source: 'agent' }
      )
    ).rejects.toThrow('Agent workspace path must be a string')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: 'model-1', mcps: [false] }, { source: 'agent' })
    ).rejects.toThrow('MCP server id must be a string')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'model-1', disabledTools: [{ name: 'Bash' }] },
        { source: 'agent' }
      )
    ).rejects.toThrow('Disabled tool must be a string')

    expect(mocks.getAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.listByCursor).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasks).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasksAcrossAgents).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.createTask).not.toHaveBeenCalled()
    expect(mocks.agentWorkspaceService.findOrCreateByPath).not.toHaveBeenCalled()
    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })
})
