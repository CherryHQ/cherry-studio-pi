import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/ai/modelValidation', () => ({
  validateModelId: mocks.validateModelId
}))

vi.mock('@main/services/agents/AgentStorageV2ReadThrough', () => ({
  getAgentSessionHistoryWithStorageV2Recovery: vi.fn().mockResolvedValue([])
}))

const { default: PiAgentService } = await import('../index')

describe('PiAgentService runtime stream', () => {
  it('replays validation errors emitted before the caller attaches a listener', async () => {
    mocks.validateModelId.mockResolvedValue({
      valid: false,
      error: { type: 'model_not_available', message: 'missing', code: 'model_not_available' }
    })

    const service = new PiAgentService()
    const stream = await service.invoke(
      'hello',
      {
        id: 'session-1',
        name: 'Agent',
        model: 'deepseek::missing',
        workspace: { path: '/tmp/pi-agent-test' }
      } as never,
      new AbortController()
    )

    await expect(
      new Promise((resolve) => {
        stream.on('data', resolve)
      })
    ).resolves.toMatchObject({
      type: 'error',
      error: expect.objectContaining({
        message: expect.stringContaining("Invalid model ID 'deepseek::missing'")
      })
    })
  })
})
