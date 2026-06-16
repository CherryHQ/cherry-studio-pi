import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      verbose: vi.fn()
    })
  }
}))

const pasteServiceStateKey = '__CHERRY_STUDIO_PI_PASTE_SERVICE_STATE__'

describe('PasteService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>)[pasteServiceStateKey]
  })

  it('registers the global paste listener only once', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener').mockImplementation(() => undefined)

    const pasteService = await import('../PasteService')
    pasteService.init()
    pasteService.init()

    expect(addEventListener.mock.calls.filter(([event]) => event === 'paste')).toHaveLength(1)

    addEventListener.mockRestore()
  })

  it('routes the global paste listener through the latest registered handler after module reloads', async () => {
    let pasteListener: ((event: ClipboardEvent) => Promise<void>) | undefined
    const addEventListener = vi.spyOn(document, 'addEventListener').mockImplementation(((
      event: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (event === 'paste' && typeof listener === 'function') {
        pasteListener = listener as unknown as (event: ClipboardEvent) => Promise<void>
      }
    }) as typeof document.addEventListener)

    const firstModule = await import('../PasteService')
    firstModule.init()
    const staleHandler = vi.fn(async () => true)
    firstModule.registerHandler('inputbar', staleHandler)

    vi.resetModules()
    const secondModule = await import('../PasteService')
    secondModule.init()
    const latestHandler = vi.fn(async () => true)
    secondModule.registerHandler('inputbar', latestHandler)

    await pasteListener?.({} as ClipboardEvent)

    expect(addEventListener.mock.calls.filter(([event]) => event === 'paste')).toHaveLength(1)
    expect(staleHandler).not.toHaveBeenCalled()
    expect(latestHandler).toHaveBeenCalledTimes(1)

    addEventListener.mockRestore()
  })
})
