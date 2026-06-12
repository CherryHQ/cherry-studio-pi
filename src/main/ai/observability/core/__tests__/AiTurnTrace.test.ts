import type { Span, Tracer } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const sinkMocks = vi.hoisted(() => ({
  registerTraceMeta: vi.fn(),
  writeSpanEntity: vi.fn()
}))

vi.mock('../../sinks/ObservabilitySinkRegistry', () => ({
  observabilitySinks: sinkMocks
}))

import { startAiTurnTrace } from '../AiTurnTrace'

function createMinimalSpan(): Span {
  const attributes: Record<string, unknown> = {}

  const span = {
    spanContext: () => ({
      traceId: 'trace-1',
      spanId: 'span-1',
      traceFlags: 1
    }),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes[key] = value
      return span
    }),
    setAttributes: vi.fn((nextAttributes: Record<string, unknown>) => {
      Object.assign(attributes, nextAttributes)
      return span
    }),
    addEvent: vi.fn(() => span),
    addLink: vi.fn(() => span),
    addLinks: vi.fn(() => span),
    setStatus: vi.fn(() => span),
    updateName: vi.fn(() => span),
    end: vi.fn(),
    isRecording: vi.fn(() => true),
    recordException: vi.fn(),
    _attributes: attributes,
    name: 'chat.turn',
    status: { code: SpanStatusCode.UNSET },
    kind: SpanKind.INTERNAL,
    ended: false,
    links: []
  } as unknown as Span

  return span
}

describe('AiTurnTrace', () => {
  beforeEach(() => {
    sinkMocks.registerTraceMeta.mockClear()
    sinkMocks.writeSpanEntity.mockClear()
    mockMainLoggerService.warn.mockClear()
  })

  it('persists root spans without assuming ReadableSpan timestamp internals', () => {
    const span = createMinimalSpan()
    const tracer = { startSpan: vi.fn(() => span) } as unknown as Tracer

    const trace = startAiTurnTrace('chat.turn', {}, { topicId: 'topic-1', modelName: 'model-1' }, tracer)

    trace.end()

    expect(mockMainLoggerService.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist root span'),
      expect.anything()
    )
    expect(sinkMocks.writeSpanEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'span-1',
        traceId: 'trace-1',
        topicId: 'topic-1',
        modelName: 'model-1',
        startTime: 0
      })
    )
  })
})
