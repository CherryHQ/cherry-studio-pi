import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appCapabilityService: {
    get: vi.fn(),
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

  afterEach(() => {
    vi.useRealTimers()
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

  it('keeps public event planning schema-aware by default', () => {
    mocks.appCapabilityService.search.mockReturnValueOnce([writeCapability])

    const plan = new SystemAgentRuntimeService().planEvent({
      type: 'error',
      source: 'settings.data_sync.sync_now',
      domain: 'dataSync',
      message: '503 Service Unavailable'
    })

    expect(mocks.appCapabilityService.search).toHaveBeenCalledWith({
      query: 'error failed diagnose troubleshoot repair dataSync settings.data_sync.sync_now 503 Service Unavailable',
      domain: 'dataSync',
      includeSchemas: true,
      limit: 6
    })
    expect(plan.recommended?.id).toBe('dataSync.sync.now')
  })

  it('auto-runs the best safe capability for error events', async () => {
    const dryRunCommandCapability = {
      id: 'storage.backup.restore',
      domain: 'storage',
      kind: 'command',
      title: 'Restore backup',
      description: 'Restore a backup',
      risk: 'destructive',
      supportsDryRun: true
    }
    const dryRunWriteCapability = {
      id: 'dataSync.webdav.diagnose',
      domain: 'dataSync',
      kind: 'query',
      title: 'Diagnose WebDAV data sync',
      description: 'Diagnose sync errors',
      risk: 'write',
      supportsDryRun: true
    }
    const readCapability = {
      id: 'dataSync.status.get',
      domain: 'dataSync',
      kind: 'query',
      title: 'Get data sync status',
      description: 'Read sync status',
      risk: 'read'
    }
    mocks.appCapabilityService.search.mockReturnValueOnce([
      writeCapability,
      dryRunCommandCapability,
      dryRunWriteCapability,
      readCapability
    ])
    mocks.appCapabilityService.call.mockResolvedValueOnce({ ok: true, summary: 'diagnosed' })

    const result = await new SystemAgentRuntimeService().handleEvent({
      type: 'error',
      source: 'settings.data_sync.sync_now',
      domain: 'dataSync',
      message: '503 Service Unavailable'
    })

    expect(mocks.appCapabilityService.search).toHaveBeenCalledWith({
      query: 'error failed diagnose troubleshoot repair dataSync settings.data_sync.sync_now 503 Service Unavailable',
      domain: 'dataSync',
      includeSchemas: false,
      limit: 6
    })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.webdav.diagnose',
      {},
      expect.objectContaining({
        source: 'system',
        dryRun: true,
        signal: expect.any(AbortSignal)
      })
    )
    expect(result.handled).toBe(true)
    expect(result.summary).toContain('dataSync.webdav.diagnose')
  })

  it('times out automatic safe capability runs for system events', async () => {
    vi.useFakeTimers()
    const readCapability = {
      id: 'dataSync.status.get',
      domain: 'dataSync',
      kind: 'query',
      title: 'Get data sync status',
      description: 'Read sync status',
      risk: 'read'
    }
    mocks.appCapabilityService.search.mockReturnValueOnce([readCapability])
    mocks.appCapabilityService.call.mockReturnValueOnce(new Promise(() => undefined))

    const resultPromise = new SystemAgentRuntimeService().handleEvent({
      type: 'error',
      source: 'settings.data_sync.sync_now',
      domain: 'dataSync',
      message: 'sync stuck'
    })

    await vi.advanceTimersByTimeAsync(10_000)

    const result = await resultPromise
    expect(result.handled).toBe(false)
    expect(result.autoRuns[0].result).toMatchObject({
      ok: false,
      isError: true,
      error: 'System agent auto-run timed out after 10s'
    })
    expect(result.summary).toContain('dataSync.status.get')
  })

  it('blocks write capabilities until the caller confirms approval', async () => {
    mocks.appCapabilityService.get.mockReturnValueOnce(writeCapability)

    const result = await new SystemAgentRuntimeService().callCapability('dataSync.sync.now')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要用户确认')
    expect(mocks.appCapabilityService.get).toHaveBeenCalledWith('dataSync.sync.now', {
      includeHidden: true,
      includeSchemas: false
    })
    expect(mocks.appCapabilityService.call).not.toHaveBeenCalled()
  })

  it('does not let dry-run bypass approval unless the capability declares dry-run support', async () => {
    mocks.appCapabilityService.get.mockReturnValueOnce(writeCapability)

    const result = await new SystemAgentRuntimeService().callCapability('dataSync.sync.now', {}, { dryRun: true })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要用户确认')
    expect(mocks.appCapabilityService.call).not.toHaveBeenCalled()
  })

  it('allows dry-run without approval only for capabilities that declare dry-run support', async () => {
    mocks.appCapabilityService.get.mockReturnValueOnce({ ...writeCapability, supportsDryRun: true })
    mocks.appCapabilityService.call.mockResolvedValueOnce({ ok: true, summary: 'dry run done' })

    const result = await new SystemAgentRuntimeService().callCapability('dataSync.sync.now', {}, { dryRun: true })

    expect(result).toEqual({ ok: true, summary: 'dry run done' })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.sync.now',
      {},
      expect.objectContaining({ dryRun: true })
    )
  })

  it('calls approved capabilities through the shared app capability service', async () => {
    mocks.appCapabilityService.get.mockReturnValueOnce(writeCapability)
    mocks.appCapabilityService.call.mockResolvedValueOnce({ ok: true, summary: 'done' })

    const result = await new SystemAgentRuntimeService().callCapability(
      'dataSync.sync.now',
      { saveConfig: false },
      { approved: true, sessionId: 'session-1' }
    )

    expect(result).toEqual({ ok: true, summary: 'done' })
    expect(mocks.appCapabilityService.get).toHaveBeenCalledWith('dataSync.sync.now', {
      includeHidden: true,
      includeSchemas: false
    })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.sync.now',
      { saveConfig: false },
      {
        source: 'system',
        sessionId: 'session-1',
        toolCallId: undefined,
        dryRun: undefined
      }
    )
  })

  it('normalizes capability ids before approval checks and direct calls', async () => {
    mocks.appCapabilityService.get.mockReturnValueOnce({ ...writeCapability, risk: 'read' })
    mocks.appCapabilityService.call.mockResolvedValueOnce({ ok: true, summary: 'done' })

    const result = await new SystemAgentRuntimeService().callCapability(' \n dataSync.sync.now \t ', {
      saveConfig: false
    })

    expect(result).toEqual({ ok: true, summary: 'done' })
    expect(mocks.appCapabilityService.get).toHaveBeenCalledWith('dataSync.sync.now', {
      includeHidden: true,
      includeSchemas: false
    })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.sync.now',
      { saveConfig: false },
      expect.objectContaining({ source: 'system' })
    )
  })
})
