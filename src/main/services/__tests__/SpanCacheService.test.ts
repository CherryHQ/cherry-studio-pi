import type { SpanEntity } from '@mcp-trace/trace-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configManager: {
    getEnableDeveloperMode: vi.fn(() => true)
  },
  fs: {
    mkdir: vi.fn(async () => undefined),
    appendFile: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    readdir: vi.fn(async () => [] as string[]),
    access: vi.fn(async () => undefined),
    open: vi.fn()
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('../ConfigManager', () => ({
  configManager: mocks.configManager
}))

vi.mock('fs/promises', () => ({
  default: mocks.fs,
  ...mocks.fs
}))

import {
  bindTopic,
  cleanTopic,
  getEntity,
  getSpans,
  saveEntity,
  saveSpans,
  spanCacheService
} from '../SpanCacheService'

function makeSpan(overrides: Partial<SpanEntity> = {}): SpanEntity {
  return {
    id: overrides.id ?? 'span-1',
    name: overrides.name ?? 'span',
    parentId: overrides.parentId ?? '',
    traceId: overrides.traceId ?? 'trace-1',
    status: overrides.status ?? 'OK',
    kind: overrides.kind ?? 'INTERNAL',
    attributes: overrides.attributes ?? {},
    isEnd: overrides.isEnd ?? true,
    events: overrides.events,
    startTime: overrides.startTime ?? 1,
    endTime: overrides.endTime ?? 2,
    links: overrides.links,
    topicId: overrides.topicId,
    usage: overrides.usage,
    modelName: overrides.modelName ?? 'model-a'
  }
}

describe('SpanCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configManager.getEnableDeveloperMode.mockReturnValue(true)
    mocks.fs.mkdir.mockResolvedValue(undefined)
    mocks.fs.appendFile.mockResolvedValue(undefined)
    mocks.fs.rm.mockResolvedValue(undefined)
    mocks.fs.readdir.mockResolvedValue([])
    mocks.fs.access.mockResolvedValue(undefined)
    spanCacheService.clear()
  })

  it('reads active trace spans from memory', async () => {
    bindTopic('trace-active', 'topic-active')
    saveEntity(makeSpan({ id: 'span-active', traceId: 'trace-active' }))
    saveEntity(makeSpan({ id: 'span-other', traceId: 'trace-other' }))

    const spans = await getSpans('topic-active', 'trace-active')

    expect(spans.map((span) => span.id)).toEqual(['span-active'])
  })

  it('saves active trace spans and removes them from memory', async () => {
    bindTopic('trace-save', 'topic-save')
    saveEntity(makeSpan({ id: 'span-save', traceId: 'trace-save' }))

    await saveSpans('topic-save')

    expect(mocks.fs.appendFile).toHaveBeenCalledTimes(1)
    const appendCalls = mocks.fs.appendFile.mock.calls as unknown as Array<[unknown, string]>
    expect(appendCalls[0]?.[1]).toContain('"id":"span-save"')
    expect(getEntity('span-save')).toBeUndefined()
  })

  it('cleans cached spans by topic before clearing persisted trace files', async () => {
    bindTopic('trace-clean-a', 'topic-clean-a')
    bindTopic('trace-clean-b', 'topic-clean-b')
    saveEntity(makeSpan({ id: 'span-clean-a', traceId: 'trace-clean-a' }))
    saveEntity(makeSpan({ id: 'span-clean-b', traceId: 'trace-clean-b' }))

    await cleanTopic('topic-clean-a')

    expect(getEntity('span-clean-a')).toBeUndefined()
    expect(getEntity('span-clean-b')).toBeDefined()
    expect(mocks.fs.readdir).toHaveBeenCalledTimes(1)
  })
})
