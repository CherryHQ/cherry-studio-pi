import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  getProviderByProviderId: vi.fn(),
  getModelByKey: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  resolveEffectiveEndpoint: vi.fn(),
  buildSessionSettings: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getProviderByProviderId,
    getRotatedApiKey: mocks.getRotatedApiKey
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getModelByKey }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken }
}))

vi.mock('../../provider/endpoint', () => ({
  resolveEffectiveEndpoint: mocks.resolveEffectiveEndpoint
}))

vi.mock('../settingsBuilder', () => ({
  buildClaudeCodeSessionSettings: mocks.buildSessionSettings
}))

const { buildClaudeCodeQueryRequestForAgentSession } = await import('../agentSessionWarmup')

describe('buildClaudeCodeQueryRequestForAgentSession resume-token precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionById.mockResolvedValue({ id: 'session-1', agentId: 'agent-1' })
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'provider-1::model-1' })
    mocks.getProviderByProviderId.mockResolvedValue({ id: 'provider-1', endpointConfigs: undefined })
    mocks.getModelByKey.mockResolvedValue({
      id: 'provider-1::model-1',
      providerId: 'provider-1',
      name: 'Claude Sonnet',
      apiModelId: 'claude-sonnet',
      isEnabled: true,
      isHidden: false
    })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getRotatedApiKey.mockResolvedValue('api-key')
    // settingsBuilder receives `lastAgentSessionId` and reflects it as `resume`;
    // mirror that so the builder's own precedence is what the test exercises.
    mocks.buildSessionSettings.mockImplementation(async (_session, _provider, options) => ({
      env: {},
      ...(options?.lastAgentSessionId ? { resume: options.lastAgentSessionId } : {})
    }))
  })

  it('uses the explicit effectiveResume token and ignores the persisted one', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', 'explicit-token')

    expect(request?.options.resume).toBe('explicit-token')
    expect(mocks.getLastRuntimeResumeToken).not.toHaveBeenCalled()
  })

  it('falls back to the persisted resume token when no explicit token is given', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBe('persisted-token')
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('leaves resume undefined when neither an explicit nor a persisted token exists', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBeUndefined()
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('uses the legacy anthropicApiHost when the model endpoint resolves to the OpenAI host', async () => {
    mocks.getProviderByProviderId.mockResolvedValue({
      id: 'deepseek',
      endpointConfigs: undefined,
      anthropicApiHost: ' https://api.deepseek.com/anthropic/ '
    })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.deepseek.com/v1' })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_API_KEY: 'api-key',
      ANTHROPIC_AUTH_TOKEN: 'api-key',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic'
    })
  })
})
