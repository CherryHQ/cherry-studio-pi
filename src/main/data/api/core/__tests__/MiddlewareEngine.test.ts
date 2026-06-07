import type { Middleware } from '@shared/data/api/apiTypes'
import { describe, expect, it } from 'vitest'

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
})
