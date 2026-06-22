import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      verbose: vi.fn()
    })
  }
}))

const composerPasteStateKey = '__CHERRY_STUDIO_PI_COMPOSER_PASTE_STATE__'

describe('composer pasteHandling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>)[composerPasteStateKey]
  })

  it('registers the global paste listener only once', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener').mockImplementation(() => undefined)

    const pasteHandling = await import('../pasteHandling')
    pasteHandling.init()
    pasteHandling.init()

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

    const firstModule = await import('../pasteHandling')
    firstModule.init()
    const staleHandler = vi.fn(async () => true)
    firstModule.registerHandler('inputbar', staleHandler)

    vi.resetModules()
    const secondModule = await import('../pasteHandling')
    secondModule.init()
    const latestHandler = vi.fn(async () => true)
    secondModule.registerHandler('inputbar', latestHandler)

    await pasteListener?.({} as ClipboardEvent)

    expect(addEventListener.mock.calls.filter(([event]) => event === 'paste')).toHaveLength(1)
    expect(staleHandler).not.toHaveBeenCalled()
    expect(latestHandler).toHaveBeenCalledTimes(1)

    addEventListener.mockRestore()
  })

  it('does not route paste events from descendants of editable content through the global handler', async () => {
    let pasteListener: ((event: ClipboardEvent) => Promise<void>) | undefined
    const addEventListener = vi.spyOn(document, 'addEventListener').mockImplementation(((
      event: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (event === 'paste' && typeof listener === 'function') {
        pasteListener = listener as unknown as (event: ClipboardEvent) => Promise<void>
      }
    }) as typeof document.addEventListener)

    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const nested = document.createElement('span')
    editor.appendChild(nested)
    document.body.appendChild(editor)

    const pasteHandling = await import('../pasteHandling')
    pasteHandling.init()
    const inputbarHandler = vi.fn(async () => true)
    pasteHandling.registerHandler('inputbar', inputbarHandler)

    await pasteListener?.({ target: nested } as unknown as ClipboardEvent)

    expect(inputbarHandler).not.toHaveBeenCalled()

    editor.remove()
    addEventListener.mockRestore()
  })
})
