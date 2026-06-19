import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

import {
  handleSystemAgentEvent,
  initSystemAgentErrorTriggers,
  reportErrorToSystemAgent,
  unregisterSystemAgentErrorTriggers
} from '../SystemAgentService'

const errorTriggerStateKey = '__CHERRY_STUDIO_PI_SYSTEM_AGENT_ERROR_TRIGGER_STATE__'

describe('SystemAgentService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T00:00:00Z'))
    originalApi = window.api
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        systemAgent: {
          handleEvent: vi.fn(async () => ({ handled: true, summary: 'ok' }))
        }
      }
    })
  })

  afterEach(() => {
    unregisterSystemAgentErrorTriggers()
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('registers global error triggers only once', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined)

    initSystemAgentErrorTriggers()
    initSystemAgentErrorTriggers()

    expect(addEventListener.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1)
    expect(addEventListener.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(1)

    addEventListener.mockRestore()
  })

  it('unregisters global error triggers and allows fresh registration', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined)
    const removeEventListener = vi.spyOn(window, 'removeEventListener').mockImplementation(() => undefined)

    initSystemAgentErrorTriggers()
    unregisterSystemAgentErrorTriggers()

    expect(removeEventListener.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1)
    expect(removeEventListener.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(1)

    initSystemAgentErrorTriggers()

    expect(addEventListener.mock.calls.filter(([event]) => event === 'error')).toHaveLength(2)
    expect(addEventListener.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(2)

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })

  it('keeps the global error trigger guard across module reloads', async () => {
    delete (globalThis as Record<string, unknown>)[errorTriggerStateKey]
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined)

    vi.resetModules()
    const firstModule = await import('../SystemAgentService')
    firstModule.initSystemAgentErrorTriggers()

    vi.resetModules()
    const secondModule = await import('../SystemAgentService')
    secondModule.initSystemAgentErrorTriggers()

    expect(addEventListener.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1)
    expect(addEventListener.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(1)

    addEventListener.mockRestore()
  })

  it('deduplicates repeated events only inside the debounce window', async () => {
    await handleSystemAgentEvent({ source: 'test.dedupe', message: 'same error' })
    await handleSystemAgentEvent({ source: 'test.dedupe', message: 'same error' })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-06-06T00:00:31Z'))
    await handleSystemAgentEvent({ source: 'test.dedupe', message: 'same error' })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps generated error messages when optional input messages are empty', async () => {
    await reportErrorToSystemAgent(new Error('fallback failure'), {
      source: 'test.fallback-message',
      message: undefined
    })
    await reportErrorToSystemAgent('string failure', {
      source: 'test.empty-message',
      message: ''
    })

    expect(window.api.systemAgent.handleEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'error',
        source: 'test.fallback-message',
        message: 'fallback failure'
      })
    )
    expect(window.api.systemAgent.handleEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'error',
        source: 'test.empty-message',
        message: 'string failure'
      })
    )
  })

  it('supports longer dedupe windows for noisy automatic diagnostics', async () => {
    await handleSystemAgentEvent({ source: 'test.long-dedupe', message: 'same error' }, { dedupeMs: 10 * 60_000 })
    await handleSystemAgentEvent({ source: 'test.long-dedupe', message: 'same error' }, { dedupeMs: 10 * 60_000 })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-06-06T00:00:31Z'))
    await handleSystemAgentEvent({ source: 'test.long-dedupe', message: 'same error' }, { dedupeMs: 10 * 60_000 })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-06-06T00:10:01Z'))
    await handleSystemAgentEvent({ source: 'test.long-dedupe', message: 'same error' }, { dedupeMs: 10 * 60_000 })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps the dedupe cache bounded so old unique errors cannot leak forever', async () => {
    for (let i = 0; i < 205; i += 1) {
      await handleSystemAgentEvent({ source: `test.bounded.${i}`, message: 'unique error' })
    }

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(205)

    await handleSystemAgentEvent({ source: 'test.bounded.0', message: 'unique error' })
    await handleSystemAgentEvent({ source: 'test.bounded.204', message: 'unique error' })

    expect(window.api.systemAgent.handleEvent).toHaveBeenCalledTimes(206)
  })
})
