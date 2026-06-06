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

  it('returns a normal error result for invalid capability ids', async () => {
    const service = new AppCapabilityService()

    await expect(service.call(null as any)).resolves.toEqual({
      ok: false,
      isError: true,
      summary: 'Capability not found: (empty)',
      error: 'Capability not found: (empty)'
    })
  })
})
