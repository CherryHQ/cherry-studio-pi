import { DataApiErrorFactory } from '@shared/data/api/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentService: {
    listAgents: vi.fn(),
    createAgent: vi.fn(),
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn()
  },
  agentSessionMessageService: {
    listMessages: vi.fn()
  },
  agentSessionService: {
    createSession: vi.fn(),
    getById: vi.fn(),
    listByCursor: vi.fn()
  },
  agentTaskService: {
    createTask: vi.fn(),
    listTasks: vi.fn()
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: mocks.agentService
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: mocks.agentSessionMessageService
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: mocks.agentSessionService
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: mocks.agentTaskService
}))

import { getSessionWithStorageV2Recovery } from '../AgentStorageV2ReadThrough'

describe('AgentStorageV2ReadThrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps legacy null behavior for missing sessions', async () => {
    mocks.agentSessionService.getById.mockRejectedValueOnce(DataApiErrorFactory.notFound('Session', 'session-1'))

    await expect(getSessionWithStorageV2Recovery('agent-1', 'session-1')).resolves.toBeNull()
  })

  it('does not hide agent session read failures as missing sessions', async () => {
    mocks.agentSessionService.getById.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(getSessionWithStorageV2Recovery('agent-1', 'session-1')).rejects.toThrow('database unavailable')
  })
})
