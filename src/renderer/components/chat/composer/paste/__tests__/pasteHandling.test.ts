import { FILE_TYPE } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import { allFilesExt } from '@shared/config/constant'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      verbose: vi.fn()
    })
  }
}))

const composerPasteStateKey = '__CHERRY_STUDIO_PI_COMPOSER_PASTE_STATE__'
const originalApiDescriptor = Object.getOwnPropertyDescriptor(window, 'api')
const originalToast = window.toast

describe('composer pasteHandling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>)[composerPasteStateKey]
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalApiDescriptor) {
      Object.defineProperty(window, 'api', originalApiDescriptor)
    } else {
      delete (window as unknown as { api?: unknown }).api
    }
    window.toast = originalToast
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

  it('accepts pasted clipboard images without paths when all files are supported', async () => {
    const pasteHandling = await import('../pasteHandling')
    const selectedFile = {
      id: 'file-1',
      name: 'clipboard.png',
      origin_name: 'clipboard.png',
      path: '/tmp/clipboard.png',
      ext: '.png',
      size: 4,
      type: FILE_TYPE.IMAGE,
      created_at: new Date().toISOString()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          getPathForFile: vi.fn(() => ''),
          createTempFile: vi.fn(async () => selectedFile.path),
          write: vi.fn(async () => undefined),
          get: vi.fn(async () => selectedFile)
        }
      }
    })
    window.toast = {
      info: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast

    const imageFile = {
      name: 'clipboard.png',
      type: 'image/png',
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
    }
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn(() => ''),
        files: [imageFile]
      }
    } as unknown as ClipboardEvent
    let attachments: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => {
      attachments = updater(attachments)
    })

    await expect(pasteHandling.handlePaste(event, [allFilesExt], setFiles)).resolves.toBe(true)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.api.file.createTempFile).toHaveBeenCalledWith('clipboard.png')
    expect(window.api.file.write).toHaveBeenCalledWith(selectedFile.path, new Uint8Array([1, 2, 3, 4]))
    expect(attachments).toEqual([
      expect.objectContaining({
        path: selectedFile.path,
        origin_name: selectedFile.origin_name,
        type: FILE_TYPE.IMAGE
      })
    ])
    expect(window.toast?.info).not.toHaveBeenCalled()
  })
})
