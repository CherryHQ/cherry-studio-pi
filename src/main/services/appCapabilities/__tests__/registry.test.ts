import { describe, expect, it } from 'vitest'

import { AppCapabilityRegistry } from '../registry'
import type { AppCapabilityDefinition } from '../types'

const capability = (overrides: Partial<AppCapabilityDefinition>): AppCapabilityDefinition => ({
  id: 'settings.read',
  domain: 'settings',
  kind: 'query',
  title: 'Read settings',
  description: 'Read app settings',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  execute: async () => ({ ok: true, summary: 'ok' }),
  ...overrides
})

describe('AppCapabilityRegistry', () => {
  it('registers, lists, and hides schemas by default', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.read' }))

    const descriptors = registry.list()

    expect(descriptors).toEqual([expect.objectContaining({ id: 'settings.read', domain: 'settings' })])
    expect(descriptors[0]).not.toHaveProperty('inputSchema')
  })

  it('searches by aliases and ranks matching capabilities', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.read', aliases: ['preferences'] }))
    registry.register(
      capability({
        id: 'storage.backup.create',
        domain: 'storage',
        kind: 'command',
        title: 'Create local backup',
        description: 'Create a local backup',
        risk: 'write',
        tags: ['backup', 'data']
      })
    )

    expect(registry.search({ query: 'local backup' }).map((item) => item.id)).toEqual(['storage.backup.create'])
    expect(registry.search({ query: 'preferences' }).map((item) => item.id)).toEqual(['settings.read'])
  })

  it('filters by domain and can include schemas', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.read' }))
    registry.register(capability({ id: 'notes.list', domain: 'notes', title: 'List notes' }))

    expect(registry.list({ domain: 'notes', includeSchemas: true })).toEqual([
      expect.objectContaining({
        id: 'notes.list',
        inputSchema: { type: 'object', properties: {} }
      })
    ])
  })

  it('limits empty searches before materializing schemas', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'a.first' }))
    const lateCapability = capability({ id: 'z.late' })
    Object.defineProperty(lateCapability, 'inputSchema', {
      get: () => {
        throw new Error('late schema should not be materialized')
      }
    })
    registry.register(lateCapability)

    expect(registry.search({ query: '', limit: 1, includeSchemas: true })).toEqual([
      expect.objectContaining({
        id: 'a.first',
        inputSchema: { type: 'object', properties: {} }
      })
    ])
  })

  it('normalizes unsafe search inputs before paging results', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'a.first' }))
    registry.register(capability({ id: 'b.second' }))
    registry.register(capability({ id: 'c.third' }))

    expect(registry.search({ query: '', limit: 'bad' as any }).map((item) => item.id)).toEqual([
      'a.first',
      'b.second',
      'c.third'
    ])
    expect(registry.search({ query: '', limit: Number.NaN }).map((item) => item.id)).toEqual([
      'a.first',
      'b.second',
      'c.third'
    ])
    expect(registry.search({ query: '', limit: 0 }).map((item) => item.id)).toEqual(['a.first'])
    expect(() => registry.search({ query: 42 as any })).not.toThrow()
  })

  it('looks up a single descriptor without listing and sorting all capabilities', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.hidden', hidden: true }))

    expect(registry.getDescriptor('settings.hidden')).toBeUndefined()
    expect(registry.getDescriptor('settings.hidden', { includeHidden: true, includeSchemas: true })).toEqual(
      expect.objectContaining({
        id: 'settings.hidden',
        inputSchema: { type: 'object', properties: {} }
      })
    )
  })

  it('expands common Chinese product intents before scoring', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.read' }))
    registry.register(
      capability({
        id: 'storage.backup.create',
        domain: 'storage',
        kind: 'command',
        title: 'Create local backup',
        description: 'Create a local backup',
        risk: 'write',
        tags: ['backup', 'data']
      })
    )
    registry.register(
      capability({
        id: 'paintings.image.generate',
        domain: 'paintings',
        kind: 'command',
        title: 'Generate image',
        description: 'Generate an image',
        risk: 'external',
        tags: ['image', 'drawing']
      })
    )
    registry.register(
      capability({
        id: 'dataSync.sync.now',
        domain: 'dataSync',
        kind: 'command',
        title: 'Sync data now',
        description: 'Run WebDAV data sync',
        risk: 'write',
        tags: ['webdav', 'sync', 'data']
      })
    )

    expect(registry.search({ query: '创建一个本地备份' }).map((item) => item.id)[0]).toBe('storage.backup.create')
    expect(registry.search({ query: '帮我画图' }).map((item) => item.id)[0]).toBe('paintings.image.generate')
    expect(registry.search({ query: '同步 webdav 数据' }).map((item) => item.id)[0]).toBe('dataSync.sync.now')
  })

  it('expands provider and credential intents to model provider capabilities', () => {
    const registry = new AppCapabilityRegistry()
    registry.register(capability({ id: 'settings.read' }))
    registry.register(
      capability({
        id: 'storage.providers.list',
        domain: 'storage',
        kind: 'query',
        title: 'List model providers',
        description: 'List model provider records with secrets redacted',
        risk: 'read',
        tags: ['storage', 'models', 'providers', 'settings']
      })
    )

    expect(registry.search({ query: '检查模型服务商密钥' }).map((item) => item.id)[0]).toBe('storage.providers.list')
  })
})
