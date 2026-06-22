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
      '服务商类型必须是字符串。'
    )
    await expect(capability('agents.models.list').execute({ limit: true }, { source: 'agent' })).rejects.toThrow(
      '智能体列表数量必须是数字。'
    )
    await expect(capability('agents.list').execute({ offset: { page: 1 } }, { source: 'agent' })).rejects.toThrow(
      '智能体列表偏移量必须是数字。'
    )
    await expect(capability('agents.list').execute({ sortBy: 123 }, { source: 'agent' })).rejects.toThrow(
      '智能体排序字段必须是字符串。'
    )
    await expect(capability('agents.list').execute({ search: ['research'] }, { source: 'agent' })).rejects.toThrow(
      '智能体搜索关键词必须是字符串。'
    )
    await expect(
      capability('agents.tasks.list').execute({ includeHeartbeat: 'true' }, { source: 'agent' })
    ).rejects.toThrow('包含心跳任务必须是布尔值。')
    await expect(capability('agents.list').execute([], { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )

    expect(mocks.modelsService.getModels).not.toHaveBeenCalled()
    expect(mocks.listAgentsWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasks).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasksAcrossAgents).not.toHaveBeenCalled()
  })

  it('rejects non-object agent capability inputs before service calls', async () => {
    await expect(capability('agents.models.list').execute('models' as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.list').execute([], { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.get').execute('agent-1' as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.create').execute(['agent'] as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.sessions.list').execute(false as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.session.create').execute(['session'] as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.tasks.list').execute('tasks' as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )
    await expect(capability('agents.task.create').execute(['task'] as any, { source: 'agent' })).rejects.toThrow(
      '智能体能力的输入必须是对象。'
    )

    expect(mocks.modelsService.getModels).not.toHaveBeenCalled()
    expect(mocks.listAgentsWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.getAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.listByCursor).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasks).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.listTasksAcrossAgents).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.createTask).not.toHaveBeenCalled()
  })

  it('stops agent read and list capabilities before service calls when aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped list work')
    const context = { source: 'agent' as const, signal: controller.signal }

    await expect(capability('agents.models.list').execute({}, context)).rejects.toThrow('agent stopped list work')
    await expect(capability('agents.list').execute({}, context)).rejects.toThrow('agent stopped list work')
    await expect(capability('agents.get').execute({ agentId: 'agent-1' }, context)).rejects.toThrow(
      'agent stopped list work'
    )
    await expect(capability('agents.sessions.list').execute({ agentId: 'agent-1' }, context)).rejects.toThrow(
      'agent stopped list work'
    )
    await expect(capability('agents.tasks.list').execute({}, context)).rejects.toThrow('agent stopped list work')

    expect(mocks.modelsService.getModels).not.toHaveBeenCalled()
    expect(mocks.listAgentsWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.getAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.listByCursor).not.toHaveBeenCalled()
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

  it('reports missing agents with a localized error', async () => {
    mocks.getAgentWithStorageV2Recovery.mockResolvedValueOnce(null)

    await expect(capability('agents.get').execute({ agentId: 'missing-agent' }, { source: 'agent' })).rejects.toThrow(
      '未找到智能体：missing-agent'
    )
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
        model: ' provider-1::model-1 ',
        type: ' claude-code ',
        sessionName: ' First task ',
        plan_model: ' provider-1::planner-1 ',
        smallModel: ' provider-1::small-1 ',
        accessible_paths: [' /tmp/work ', ''],
        mcps: [' docs ', 'docs'],
        disabledTools: [' Bash ', 'Bash'],
        configuration: { max_turns: 5 }
      },
      { source: 'agent' }
    )

    expect(mocks.createAgentWithStorageV2Recovery).toHaveBeenCalledWith({
      name: 'Agent One',
      model: 'provider-1::model-1',
      type: 'claude-code',
      description: undefined,
      instructions: undefined,
      planModel: 'provider-1::planner-1',
      smallModel: 'provider-1::small-1',
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

  it('stops agent creation before workspace or agent writes when aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped creation')

    await expect(
      capability('agents.create').execute(
        {
          name: 'Agent One',
          model: 'provider-1::model-1',
          workspacePath: '/tmp/work'
        },
        { source: 'agent', signal: controller.signal }
      )
    ).rejects.toThrow('agent stopped creation')

    expect(mocks.agentWorkspaceService.findOrCreateByPath).not.toHaveBeenCalled()
    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })

  it('stops agent creation after workspace resolution when cancelled before agent write', async () => {
    const controller = new AbortController()
    mocks.agentWorkspaceService.findOrCreateByPath.mockImplementationOnce(async () => {
      controller.abort(new Error('agent stopped after workspace'))
      return { id: 'workspace-1', path: '/tmp/work' }
    })

    await expect(
      capability('agents.create').execute(
        {
          name: 'Agent One',
          model: 'provider-1::model-1',
          workspacePath: '/tmp/work'
        },
        { source: 'agent', signal: controller.signal }
      )
    ).rejects.toThrow('agent stopped after workspace')

    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })

  it('stops default session creation when agent creation is cancelled after the agent write', async () => {
    const controller = new AbortController()
    mocks.createAgentWithStorageV2Recovery.mockImplementationOnce(async () => {
      controller.abort(new Error('agent stopped after agent write'))
      return { id: 'agent-1', name: 'Agent One' }
    })

    await expect(
      capability('agents.create').execute(
        {
          name: 'Agent One',
          model: 'provider-1::model-1'
        },
        { source: 'agent', signal: controller.signal }
      )
    ).rejects.toThrow('agent stopped after agent write')

    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })

  it('accepts UI-style workspacePath when creating an initial agent session', async () => {
    await capability('agents.create').execute(
      {
        name: 'Agent One',
        model: 'provider-1::model-1',
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
        model: 'provider-1::model-1',
        workspacePath: ' /Users/me/primary ',
        accessible_paths: [' /Users/me/legacy ']
      },
      { source: 'agent' }
    )

    expect(mocks.agentWorkspaceService.findOrCreateByPath).toHaveBeenCalledWith('/Users/me/primary')
  })

  it('defaults app-created agents to the Pi runtime', async () => {
    await capability('agents.create').execute(
      { name: ' Agent One ', model: ' provider-1::model-1 ' },
      { source: 'agent' }
    )

    expect(mocks.createAgentWithStorageV2Recovery).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pi'
      })
    )
  })

  it('returns a warning when the default agent session cannot be created', async () => {
    mocks.agentSessionService.createSession.mockRejectedValueOnce(new Error('workspace unavailable'))

    const result = await capability('agents.create').execute(
      { name: 'Agent One', model: 'provider-1::model-1' },
      { source: 'agent' }
    )

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('默认会话创建失败')
    expect(result.data).toMatchObject({
      agent: { id: 'agent-1', name: 'Agent One' },
      defaultSession: null,
      warnings: ['默认会话创建失败：workspace unavailable']
    })
  })

  it('rejects empty required agent inputs before calling services', async () => {
    await expect(
      capability('agents.create').execute({ name: '   ', model: 'provider-1::model-1' }, { source: 'agent' })
    ).rejects.toThrow('智能体名称不能为空。')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: '   ' }, { source: 'agent' })
    ).rejects.toThrow('智能体模型不能为空。')
    await expect(capability('agents.get').execute({ agentId: '   ' }, { source: 'agent' })).rejects.toThrow(
      '智能体 ID 不能为空。'
    )
    await expect(capability('agents.session.create').execute({ agentId: '   ' }, { source: 'agent' })).rejects.toThrow(
      '智能体 ID 不能为空。'
    )
    await expect(
      capability('agents.task.create').execute({ agentId: 'agent-1', task: [] }, { source: 'agent' })
    ).rejects.toThrow('智能体任务不能为空。')

    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.getAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.createTask).not.toHaveBeenCalled()
  })

  it('stops agent session and task creation before writes when aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped writes')
    const context = { source: 'agent' as const, signal: controller.signal }

    await expect(
      capability('agents.session.create').execute({ agentId: 'agent-1', name: 'Research' }, context)
    ).rejects.toThrow('agent stopped writes')
    await expect(
      capability('agents.task.create').execute({ agentId: 'agent-1', task: { title: 'Check sync' } }, context)
    ).rejects.toThrow('agent stopped writes')

    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
    expect(mocks.agentTaskService.createTask).not.toHaveBeenCalled()
  })

  it('rejects invalid optional agent creation fields before writing', async () => {
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', accessible_paths: '/tmp/work' },
        { source: 'agent' }
      )
    ).rejects.toThrow('可访问路径列表必须是数组。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', mcps: 'docs' },
        { source: 'agent' }
      )
    ).rejects.toThrow('MCP 服务 ID 列表必须是数组。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', disabledTools: 'Bash' },
        { source: 'agent' }
      )
    ).rejects.toThrow('禁用工具列表必须是数组。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', configuration: [] },
        { source: 'agent' }
      )
    ).rejects.toThrow('智能体配置必须是对象。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', type: 'unsupported' },
        { source: 'agent' }
      )
    ).rejects.toThrow('不支持的智能体类型：unsupported')

    expect(mocks.agentWorkspaceService.findOrCreateByPath).not.toHaveBeenCalled()
    expect(mocks.createAgentWithStorageV2Recovery).not.toHaveBeenCalled()
    expect(mocks.agentSessionService.createSession).not.toHaveBeenCalled()
  })

  it('rejects invalid agent text input shapes before side effects', async () => {
    await expect(capability('agents.get').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      '智能体 ID 必须是字符串。'
    )
    await expect(capability('agents.sessions.list').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      '智能体 ID 必须是字符串。'
    )
    await expect(capability('agents.tasks.list').execute({ agentId: 123 }, { source: 'agent' })).rejects.toThrow(
      '智能体 ID 必须是字符串。'
    )
    await expect(
      capability('agents.session.create').execute({ agentId: 'agent-1', name: ['Research'] }, { source: 'agent' })
    ).rejects.toThrow('会话名称必须是字符串。')
    await expect(
      capability('agents.session.create').execute(
        { agentId: 'agent-1', description: { text: 'Explore docs' } },
        { source: 'agent' }
      )
    ).rejects.toThrow('会话描述必须是字符串。')
    await expect(
      capability('agents.task.create').execute({ agentId: false, task: { title: 'Check sync' } }, { source: 'agent' })
    ).rejects.toThrow('智能体 ID 必须是字符串。')
    await expect(
      capability('agents.create').execute({ name: 123, model: 'provider-1::model-1' }, { source: 'agent' })
    ).rejects.toThrow('智能体名称必须是字符串。')
    await expect(
      capability('agents.create').execute({ name: 'Agent One', model: 123 }, { source: 'agent' })
    ).rejects.toThrow('智能体模型必须是字符串。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', type: 123, accessible_paths: ['/tmp/work'] },
        { source: 'agent' }
      )
    ).rejects.toThrow('智能体类型必须是字符串。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', accessible_paths: [123] },
        { source: 'agent' }
      )
    ).rejects.toThrow('可访问路径必须是字符串。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', workspacePath: { path: '/tmp/work' } },
        { source: 'agent' }
      )
    ).rejects.toThrow('智能体工作目录必须是字符串。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', mcps: [false] },
        { source: 'agent' }
      )
    ).rejects.toThrow('MCP 服务 ID 必须是字符串。')
    await expect(
      capability('agents.create').execute(
        { name: 'Agent One', model: 'provider-1::model-1', disabledTools: [{ name: 'Bash' }] },
        { source: 'agent' }
      )
    ).rejects.toThrow('禁用工具必须是字符串。')

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
