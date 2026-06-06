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

import { handleSystemAgentEvent, initSystemAgentErrorTriggers } from '../SystemAgentService'

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
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('registers global error triggers only once', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')

    initSystemAgentErrorTriggers()
    initSystemAgentErrorTriggers()

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
