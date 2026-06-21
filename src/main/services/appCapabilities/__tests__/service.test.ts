import { describe, expect, it, vi } from 'vitest'

import type { AppCapabilityRegistry } from '../registry'

const { executeCapability, loggerInfo, loggerWarn } = vi.hoisted(() => ({
  executeCapability: vi.fn(async () => ({ ok: true, summary: 'called' })),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: loggerInfo,
      warn: loggerWarn
    }))
  }
}))

vi.mock('../providers', () => ({
  registerAppCapabilities: vi.fn((registry: Pick<AppCapabilityRegistry, 'register'>) => {
    registry.register({
      id: 'settings.read',
      domain: 'settings',
      kind: 'query',
      title: 'Read settings',
      description: 'Read app settings',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      execute: executeCapability
    })
    registry.register({
      id: 'settings.value.set',
      domain: 'settings',
      kind: 'command',
      title: 'Set setting',
      description: 'Set one setting',
      inputSchema: { type: 'object', properties: {} },
      risk: 'write',
      execute: executeCapability
    })
  })
}))

import { AppCapabilityService } from '../service'

describe('AppCapabilityService', () => {
  it('normalizes capability ids before lookup', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()

    const result = await service.call(' \n settings.read \t ', { scope: 'all' }, { source: 'agent', dryRun: true })

    expect(result).toEqual({ ok: true, summary: 'called' })
    expect(executeCapability).toHaveBeenCalledWith(
      { scope: 'all' },
      expect.objectContaining({ source: 'agent', dryRun: true })
    )
  })

  it('blocks dry-run calls for side-effecting capabilities that do not support dry run', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()

    const result = await service.call('settings.value.set', { path: 'theme', value: 'dark' }, { dryRun: true })

    expect(result).toEqual({
      ok: false,
      isError: true,
      summary: '能力不支持 dry run：settings.value.set',
      error: '能力不支持 dry run：settings.value.set'
    })
    expect(executeCapability).not.toHaveBeenCalled()
  })

  it('returns a normal error result for invalid capability ids', async () => {
    const service = new AppCapabilityService()

    await expect(service.call(null as any)).resolves.toEqual({
      ok: false,
      isError: true,
      summary: '未找到能力：(empty)',
      error: '未找到能力：(empty)'
    })
  })

  it('redacts secrets from invalid agent capability ids before returning them', async () => {
    const service = new AppCapabilityService()

    const result = await service.call('missing.apiKey=sk-secret-token', {}, { source: 'agent' })

    expect(JSON.stringify(result)).not.toContain('sk-secret-token')
    expect(result).toMatchObject({
      ok: false,
      isError: true,
      summary: '未找到能力：missing.apiKey=[redacted]',
      error: '未找到能力：missing.apiKey=[redacted]'
    })
  })

  it('short-circuits calls when the signal is already aborted', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()
    const controller = new AbortController()
    controller.abort(new Error('user stopped task'))

    await expect(service.call('settings.read', {}, { source: 'agent', signal: controller.signal })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 已取消：user stopped task',
      error: 'user stopped task'
    })

    expect(executeCapability).not.toHaveBeenCalled()
  })

  it('redacts secrets from agent abort reasons before returning them', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()
    const controller = new AbortController()
    controller.abort(new Error('stopped with password=plain-secret'))

    const result = await service.call('settings.read', {}, { source: 'agent', signal: controller.signal })

    expect(JSON.stringify(result)).not.toContain('plain-secret')
    expect(result).toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 已取消：stopped with password=[redacted]',
      error: 'stopped with password=[redacted]'
    })
    expect(executeCapability).not.toHaveBeenCalled()
  })

  it('drops capability results when the signal is aborted during execution', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()
    const controller = new AbortController()
    executeCapability.mockImplementationOnce(async () => {
      controller.abort(new Error('user stopped while running'))
      return { ok: true, summary: 'late success' }
    })

    await expect(service.call('settings.read', {}, { source: 'agent', signal: controller.signal })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 已取消：user stopped while running',
      error: 'user stopped while running'
    })

    expect(executeCapability).toHaveBeenCalledTimes(1)
  })

  it('returns aborted without waiting for providers that ignore the signal', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()
    const controller = new AbortController()
    executeCapability.mockImplementationOnce(async () => new Promise(() => undefined))

    const resultPromise = service.call('settings.read', {}, { source: 'agent', signal: controller.signal })
    await Promise.resolve()
    controller.abort(new Error('user stopped a stuck provider'))

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 已取消：user stopped a stuck provider',
      error: 'user stopped a stuck provider'
    })
    expect(executeCapability).toHaveBeenCalledTimes(1)
  })

  it('reports aborted when capability execution throws after the signal aborts', async () => {
    executeCapability.mockClear()
    const service = new AppCapabilityService()
    const controller = new AbortController()
    executeCapability.mockImplementationOnce(async () => {
      controller.abort(new Error('system timeout'))
      throw new Error('provider noticed abort')
    })

    await expect(service.call('settings.read', {}, { source: 'agent', signal: controller.signal })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 已取消：system timeout',
      error: 'system timeout'
    })

    expect(executeCapability).toHaveBeenCalledTimes(1)
  })

  it('sanitizes agent capability results at the service boundary', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({
      ok: true,
      summary: 'returned raw provider data',
      data: {
        apiKey: 'sk-secret',
        nested: { password: 'hidden' },
        text: 'x'.repeat(9_000)
      },
      warnings: ['w'.repeat(9_000)],
      artifacts: [
        {
          type: 'debug',
          metadata: {
            token: 'sensitive-token',
            visible: 'ok'
          }
        }
      ]
    } as any)
    const service = new AppCapabilityService()

    const result = await service.call('settings.read', {}, { source: 'agent' })

    expect((result.data as any).apiKey).toBe('[redacted]')
    expect((result.data as any).nested).toEqual({ password: '[redacted]' })
    expect((result.data as any).text).toContain('[truncated 1000 chars]')
    expect((result.data as any).text).not.toContain('x'.repeat(8_500))
    expect(result.warnings?.[0]).toContain('[truncated 1000 chars]')
    expect(result.artifacts?.[0].metadata).toEqual({
      token: '[redacted]',
      visible: 'ok'
    })
  })

  it('redacts secrets embedded in agent capability summary and error text', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({
      ok: false,
      isError: true,
      summary: 'Failed with apiKey=sk-secret-token',
      error: 'Authorization: Bearer bearer-secret at https://user:pass@example.test',
      warnings: ['password=plain-secret', 'passage=visible']
    } as any)
    const service = new AppCapabilityService()

    const result = await service.call('settings.read', {}, { source: 'agent' })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('sk-secret-token')
    expect(serialized).not.toContain('bearer-secret')
    expect(serialized).not.toContain('plain-secret')
    expect(serialized).not.toContain('user:pass')
    expect(result.summary).toContain('apiKey=[redacted]')
    expect(result.error).toContain('Authorization: Bearer [redacted]')
    expect(result.error).toContain('https://[redacted]@example.test')
    expect(result.warnings).toEqual(['password=[redacted]', 'passage=visible'])
  })

  it('redacts secrets embedded in thrown agent capability errors', async () => {
    loggerWarn.mockClear()
    executeCapability.mockReset()
    executeCapability.mockRejectedValueOnce(
      new Error(
        'Failed with apiKey=sk-secret-token and Authorization: Bearer bearer-secret at https://user:pass@example.test'
      )
    )
    const service = new AppCapabilityService()

    const result = await service.call('settings.read', {}, { source: 'agent' })
    const serialized = JSON.stringify(result)

    expect(result.ok).toBe(false)
    expect(serialized).not.toContain('sk-secret-token')
    expect(serialized).not.toContain('bearer-secret')
    expect(serialized).not.toContain('user:pass')
    expect(result.summary).toContain('apiKey=[redacted]')
    expect(result.summary).toContain('Authorization: Bearer [redacted]')
    expect(result.summary).toContain('https://[redacted]@example.test')
    expect(result.error).toContain('apiKey=[redacted]')
    expect(loggerWarn).toHaveBeenCalledWith('App capability failed', {
      id: 'settings.read',
      error: 'Failed with apiKey=[redacted] and Authorization: Bearer [redacted] at https://[redacted]@example.test'
    })
  })

  it('does not sanitize non-agent capability results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({
      ok: true,
      summary: 'system result',
      data: {
        apiKey: 'sk-secret',
        text: 'x'.repeat(9_000)
      }
    } as any)
    const service = new AppCapabilityService()

    const result = await service.call('settings.read', {}, { source: 'system' })

    expect((result.data as any).apiKey).toBe('sk-secret')
    expect((result.data as any).text).toHaveLength(9_000)
  })

  it('converts missing capability return values into standard error results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce(undefined as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 返回了无效结果：应返回对象',
      error: 'settings.read 返回了无效结果：应返回对象'
    })
  })

  it('converts capability results without a boolean ok field into standard error results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({ summary: 'not enough shape' } as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 返回了无效结果：缺少布尔值 ok',
      error: 'settings.read 返回了无效结果：缺少布尔值 ok'
    })
  })

  it('fills a fallback summary for otherwise valid capability results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({ ok: true, data: { value: 1 } } as any)
    executeCapability.mockResolvedValueOnce({ ok: false, error: 'bad input' } as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: true,
      summary: 'settings.read 已完成',
      data: { value: 1 }
    })

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read 调用失败：bad input',
      error: 'bad input'
    })
  })

  it('normalizes contradictory provider error flags from successful results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({
      ok: true,
      isError: true,
      summary: 'settings updated',
      data: { value: 'dark' }
    } as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: true,
      summary: 'settings updated',
      data: { value: 'dark' }
    })
  })
})
