import { describe, expect, it, vi } from 'vitest'

import type { AppCapabilityRegistry } from '../registry'

const { executeCapability } = vi.hoisted(() => ({
  executeCapability: vi.fn(async () => ({ ok: true, summary: 'called' }))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn()
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
      summary: 'Capability does not support dry run: settings.value.set',
      error: 'Capability does not support dry run: settings.value.set'
    })
    expect(executeCapability).not.toHaveBeenCalled()
  })

  it('returns a normal error result for invalid capability ids', async () => {
    const service = new AppCapabilityService()

    await expect(service.call(null as any)).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'Capability not found: (empty)',
      error: 'Capability not found: (empty)'
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
      summary: 'settings.read aborted: user stopped task',
      error: 'user stopped task'
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
      summary: 'settings.read aborted: user stopped while running',
      error: 'user stopped while running'
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
      summary: 'settings.read aborted: system timeout',
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
      summary: 'settings.read returned an invalid result: expected an object',
      error: 'settings.read returned an invalid result: expected an object'
    })
  })

  it('converts capability results without a boolean ok field into standard error results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({ summary: 'not enough shape' } as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read returned an invalid result: missing boolean ok',
      error: 'settings.read returned an invalid result: missing boolean ok'
    })
  })

  it('fills a fallback summary for otherwise valid capability results', async () => {
    executeCapability.mockReset()
    executeCapability.mockResolvedValueOnce({ ok: true, data: { value: 1 } } as any)
    executeCapability.mockResolvedValueOnce({ ok: false, error: 'bad input' } as any)
    const service = new AppCapabilityService()

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: true,
      summary: 'settings.read completed',
      data: { value: 1 }
    })

    await expect(service.call('settings.read', {}, { source: 'agent' })).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'settings.read failed: bad input',
      error: 'bad input'
    })
  })
})
