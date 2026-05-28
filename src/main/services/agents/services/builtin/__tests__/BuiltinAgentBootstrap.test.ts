import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInstallBuiltinSkills,
  mockInitDefaultCherryClawAgent,
  mockInitBuiltinAgent,
  mockListSessions,
  mockCreateSession,
  mockGetAgentWithStorageV2Recovery,
  mockScheduleStorageV2Mirror,
  mockFlushStorageV2Mirror,
  mockEnsureHeartbeatTask
} = vi.hoisted(() => ({
  mockInstallBuiltinSkills: vi.fn(),
  mockInitDefaultCherryClawAgent: vi.fn(),
  mockInitBuiltinAgent: vi.fn(),
  mockListSessions: vi.fn(),
  mockCreateSession: vi.fn(),
  mockGetAgentWithStorageV2Recovery: vi.fn(),
  mockScheduleStorageV2Mirror: vi.fn(),
  mockFlushStorageV2Mirror: vi.fn(),
  mockEnsureHeartbeatTask: vi.fn()
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    initDefaultCherryClawAgent: mockInitDefaultCherryClawAgent,
    initBuiltinAgent: mockInitBuiltinAgent
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    listSessions: mockListSessions,
    createSession: mockCreateSession
  }
}))

vi.mock('@main/services/agents/AgentStorageV2ReadThrough', () => ({
  createSessionWithStorageV2Recovery: mockCreateSession,
  getAgentWithStorageV2Recovery: mockGetAgentWithStorageV2Recovery,
  listSessionsWithStorageV2Recovery: mockListSessions
}))

vi.mock('@main/services/storageV2/AgentDbMirrorService', () => ({
  storageV2AgentDbMirrorService: {
    flush: mockFlushStorageV2Mirror,
    schedule: mockScheduleStorageV2Mirror
  }
}))

vi.mock('../../SchedulerService', () => ({
  schedulerService: {
    ensureHeartbeatTask: mockEnsureHeartbeatTask
  }
}))

vi.mock('../BuiltinAgentProvisioner', () => ({
  provisionBuiltinAgent: vi.fn()
}))

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
    mockGetAgentWithStorageV2Recovery.mockResolvedValue(null)
    mockListSessions.mockResolvedValue({ total: 0 })
    mockCreateSession.mockResolvedValue({ id: 'session_1' })
    mockFlushStorageV2Mirror.mockResolvedValue(undefined)
    mockEnsureHeartbeatTask.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries built-in bootstrap when no model is available yet', async () => {
    mockInitDefaultCherryClawAgent
      .mockResolvedValueOnce({ agentId: null, skippedReason: 'no_model' })
      .mockResolvedValueOnce({ agentId: 'cherry-claw-default' })
    mockInitBuiltinAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)

    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(2)
    expect(mockListSessions).toHaveBeenCalledWith('cherry-claw-default', { limit: 1 })
    expect(mockCreateSession).toHaveBeenCalledWith('cherry-claw-default', {})
    expect(mockEnsureHeartbeatTask).toHaveBeenCalledWith('cherry-claw-default', 30)
    expect(mockScheduleStorageV2Mirror).toHaveBeenCalled()
    expect(mockFlushStorageV2Mirror).toHaveBeenCalled()
  })

  it('does not retry built-in agents deleted by the user', async () => {
    mockInitDefaultCherryClawAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })
    mockInitBuiltinAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    await vi.advanceTimersByTimeAsync(60000)

    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(1)
    expect(mockInitBuiltinAgent).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockEnsureHeartbeatTask).not.toHaveBeenCalled()
  })
})
