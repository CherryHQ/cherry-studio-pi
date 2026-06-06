import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/constant', () => ({
  PPIO_APP_SECRET: 'ppio-secret',
  PPIO_CLIENT_ID: 'ppio-client',
  SILICON_CLIENT_ID: 'silicon-client',
  TOKENFLUX_HOST: 'https://tokenflux.example'
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  },
  getLanguageCode: () => 'en'
}))

describe('oauth utilities', () => {
  const close = vi.fn()
  let addEventListenerSpy: MockInstance<typeof window.addEventListener>
  let removeEventListenerSpy: MockInstance<typeof window.removeEventListener>
  let openSpy: MockInstance<typeof window.open>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    openSpy = vi.spyOn(window, 'open').mockReturnValue({ close } as any)
  })

  afterEach(() => {
    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
    openSpy.mockRestore()
  })

  it('replaces the previous SiliconFlow message listener before registering a new one', async () => {
    const { oauthWithSiliconFlow } = await import('../oauth')
    const firstSetKey = vi.fn()
    const secondSetKey = vi.fn()

    await oauthWithSiliconFlow(firstSetKey)
    const firstHandler = addEventListenerSpy.mock.calls.find(([event]) => event === 'message')?.[1]

    await oauthWithSiliconFlow(secondSetKey)
    const secondHandler = addEventListenerSpy.mock.calls.filter(([event]) => event === 'message').at(-1)?.[1]

    expect(removeEventListenerSpy).toHaveBeenCalledWith('message', firstHandler)
    expect(() => {
      ;(secondHandler as EventListener)(new MessageEvent('message', { data: { ignored: true } }))
    }).not.toThrow()

    ;(secondHandler as EventListener)(new MessageEvent('message', { data: [{ secretKey: 'sk-test' }] }))

    expect(firstSetKey).not.toHaveBeenCalled()
    expect(secondSetKey).toHaveBeenCalledWith('sk-test')
    expect(close).toHaveBeenCalled()
  })

  it('opens Aihubmix OAuth URL without a leading space', async () => {
    const { oauthWithAihubmix } = await import('../oauth')

    await oauthWithAihubmix(vi.fn())

    expect(openSpy.mock.calls[0]?.[0]).toMatch(/^https:\/\/console\.aihubmix\.com\//)
  })

  it('ignores unrelated 302.AI messages without throwing', async () => {
    const { oauthWith302AI } = await import('../oauth')

    await oauthWith302AI(vi.fn())
    const handler = addEventListenerSpy.mock.calls.find(([event]) => event === 'message')?.[1]

    expect(() => {
      ;(handler as EventListener)(new MessageEvent('message', { data: {} }))
    }).not.toThrow()
  })
})
