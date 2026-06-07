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
  let toastError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    toastError = vi.fn()
    ;(window as any).toast = { error: toastError }
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    openSpy = vi.spyOn(window, 'open').mockReturnValue({ close } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
      ;(secondHandler as EventListener)(
        new MessageEvent('message', { data: { ignored: true }, origin: 'https://account.siliconflow.cn' })
      )
    }).not.toThrow()

    ;(secondHandler as EventListener)(
      new MessageEvent('message', { data: [{ secretKey: 'sk-test' }], origin: 'https://account.siliconflow.cn' })
    )

    expect(firstSetKey).not.toHaveBeenCalled()
    expect(secondSetKey).toHaveBeenCalledWith('sk-test')
    expect(close).toHaveBeenCalled()
  })

  it('ignores SiliconFlow OAuth messages from untrusted origins', async () => {
    const { oauthWithSiliconFlow } = await import('../oauth')
    const setKey = vi.fn()

    await oauthWithSiliconFlow(setKey)
    const handler = addEventListenerSpy.mock.calls.find(([event]) => event === 'message')?.[1]

    ;(handler as EventListener)(
      new MessageEvent('message', { data: [{ secretKey: 'sk-evil' }], origin: 'https://evil.example' })
    )

    expect(setKey).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
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
      ;(handler as EventListener)(new MessageEvent('message', { data: {}, origin: 'https://dash.302.ai' }))
    }).not.toThrow()
  })

  it('ignores 302.AI OAuth messages from untrusted origins', async () => {
    const { oauthWith302AI } = await import('../oauth')
    const setKey = vi.fn()

    await oauthWith302AI(setKey)
    const handler = addEventListenerSpy.mock.calls.find(([event]) => event === 'message')?.[1]

    ;(handler as EventListener)(
      new MessageEvent('message', { data: { data: { apikey: 'sk-evil' } }, origin: 'https://evil.example' })
    )

    expect(setKey).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('opens TokenFlux OAuth URL with a bounded auth-url request', async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: { url: 'https://tokenflux.example/login' } })
      })
    )

    const { oauthWithTokenFlux } = await import('../oauth')
    await oauthWithTokenFlux()

    expect(timeoutSpy).toHaveBeenCalledWith(10000)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/auth-url'),
      expect.objectContaining({ signal: timeoutSignal })
    )
    expect(openSpy).toHaveBeenCalledWith('https://tokenflux.example/login', 'oauth', expect.any(String))

    timeoutSpy.mockRestore()
  })

  it('handles TokenFlux OAuth auth-url request failures without throwing', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { oauthWithTokenFlux } = await import('../oauth')
    await expect(oauthWithTokenFlux()).resolves.toBeUndefined()

    expect(toastError).toHaveBeenCalledWith('settings.provider.oauth.error')

    timeoutSpy.mockRestore()
  })
})
