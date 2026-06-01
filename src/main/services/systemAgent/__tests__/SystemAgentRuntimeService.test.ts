import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appCapabilityService: {
    list: vi.fn(),
    search: vi.fn(),
    call: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/services/appCapabilities', () => ({
  appCapabilityService: mocks.appCapabilityService
}))

import { SystemAgentRuntimeService } from '../SystemAgentRuntimeService'

const writeCapability = {
  id: 'dataSync.sync.now',
  domain: 'dataSync',
  kind: 'command',
  title: 'Sync data now',
  description: 'Run data sync',
  risk: 'write'
}

describe('SystemAgentRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plans an intent through app capabilities', () => {
    mocks.appCapabilityService.search.mockReturnValueOnce([writeCapability])

    const plan = new SystemAgentRuntimeService().planIntent({ intent: '同步我的 WebDAV 数据' })

    expect(mocks.appCapabilityService.search).toHaveBeenCalledWith({
      query: '同步我的 WebDAV 数据',
      domain: undefined,
      risk: undefined,
      includeHidden: undefined,
      includeSchemas: true,
      limit: 8
    })
    expect(plan.recommended?.id).toBe('dataSync.sync.now')
    expect(plan.guidance).toContain('需要用户确认')
  })

  it('blocks write capabilities until the caller confirms approval', async () => {
    mocks.appCapabilityService.list.mockReturnValueOnce([writeCapability])

    const result = await new SystemAgentRuntimeService().callCapability('dataSync.sync.now')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要用户确认')
    expect(mocks.appCapabilityService.call).not.toHaveBeenCalled()
  })

  it('calls approved capabilities through the shared app capability service', async () => {
    mocks.appCapabilityService.list.mockReturnValueOnce([writeCapability])
    mocks.appCapabilityService.call.mockResolvedValueOnce({ ok: true, summary: 'done' })

    const result = await new SystemAgentRuntimeService().callCapability(
      'dataSync.sync.now',
      { saveConfig: false },
      { approved: true, sessionId: 'session-1' }
    )

    expect(result).toEqual({ ok: true, summary: 'done' })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.sync.now',
      { saveConfig: false },
      {
        source: 'ui',
        sessionId: 'session-1',
        toolCallId: undefined,
        dryRun: undefined
      }
    )
  })
})
