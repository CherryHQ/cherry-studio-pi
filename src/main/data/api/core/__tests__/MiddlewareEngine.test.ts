import type { Middleware, RequestContext } from '@shared/data/api/apiTypes'
import { describe, expect, it, vi } from 'vitest'

const { debugMock, errorMock, warnMock } = vi.hoisted(() => ({
  debugMock: vi.fn(),
  errorMock: vi.fn(),
  warnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: debugMock,
      error: errorMock,
      warn: warnMock
    })
  }
}))

import { MiddlewareEngine } from '../MiddlewareEngine'

const noop: Middleware['execute'] = async (_req, _res, next) => {
  await next()
}

describe('MiddlewareEngine', () => {
  it('keeps built-in middleware in priority order', () => {
    const engine = new MiddlewareEngine()

    expect(engine.getMiddlewares()).toEqual(['error-handler', 'request-logger', 'response-formatter'])
  })

  it('preserves priority 0 instead of falling back to the default priority', () => {
    const engine = new MiddlewareEngine()
    engine.clear()

    engine.use({ name: 'default-priority', execute: noop })
    engine.use({ name: 'zero-priority', priority: 0, execute: noop })

    expect(engine.getMiddlewares()).toEqual(['zero-priority', 'default-priority'])
  })

  it('replaces an existing middleware order entry when registering the same name again', () => {
    const engine = new MiddlewareEngine()
    engine.clear()

    engine.use({ name: 'shared', priority: 80, execute: noop })
    engine.use({ name: 'early', priority: 10, execute: noop })
    engine.use({ name: 'shared', priority: 5, execute: noop })

    expect(engine.getMiddlewares()).toEqual(['shared', 'early'])
  })

  it('does not write request bodies or headers to request logs', async () => {
    const engine = new MiddlewareEngine()
    const context: RequestContext = {
      request: {
        id: 'req-secret',
        method: 'POST',
        path: '/providers/openai/api-keys',
        params: { enabled: true },
        body: { key: 'sk-secret-value', label: 'Primary' },
        headers: { Authorization: 'Bearer secret-token' }
      },
      response: { id: 'req-secret', status: 200 },
      path: '/providers/openai/api-keys',
      method: 'POST',
      data: new Map()
    }

    await engine.executeMiddlewares(context)

    const serializedLogs = debugMock.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(serializedLogs).toContain('"hasBody":true')
    expect(serializedLogs).toContain('"hasHeaders":true')
    expect(serializedLogs).not.toContain('sk-secret-value')
    expect(serializedLogs).not.toContain('secret-token')
    expect(serializedLogs).not.toContain('Authorization')
  })
})
