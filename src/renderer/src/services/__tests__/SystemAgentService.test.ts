import { describe, expect, it, vi } from 'vitest'

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

import { initSystemAgentErrorTriggers } from '../SystemAgentService'

describe('SystemAgentService', () => {
  it('registers global error triggers only once', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')

    initSystemAgentErrorTriggers()
    initSystemAgentErrorTriggers()

    expect(addEventListener.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1)
    expect(addEventListener.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(1)

    addEventListener.mockRestore()
  })
})
