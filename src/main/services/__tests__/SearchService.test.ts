import { BaseService } from '@main/core/lifecycle'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchService } from '../SearchService'

type MockSearchWindow = EventEmitter & {
  close: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  webContents: EventEmitter & {
    executeJavaScript: ReturnType<typeof vi.fn>
    userAgent?: string
  }
}

function createMockSearchWindow(): MockSearchWindow {
  const webContents = new EventEmitter() as MockSearchWindow['webContents']
  webContents.executeJavaScript = vi.fn().mockResolvedValue('<html></html>')

  const window = new EventEmitter() as MockSearchWindow
  window.close = vi.fn()
  window.loadURL = vi.fn().mockResolvedValue(undefined)
  window.show = vi.fn()
  window.webContents = webContents
  return window
}

describe('SearchService', () => {
  let window: MockSearchWindow

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    BaseService.resetInstances()
    window = createMockSearchWindow()
    vi.mocked(BrowserWindow).mockImplementation(() => window as unknown as BrowserWindow)
  })

  afterEach(() => {
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  it('clears the load timeout after the search window finishes loading', async () => {
    const service = new SearchService()
    const resultPromise = service.openUrlInSearchWindow('search-1', 'https://example.com')

    await vi.waitFor(() => expect(window.webContents.listenerCount('did-finish-load')).toBe(1))

    window.webContents.emit('did-finish-load')

    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(500)

    await expect(resultPromise).resolves.toBe('<html></html>')
    expect(window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('creates isolated search windows for remote URLs', async () => {
    const service = new SearchService()

    await service.openSearchWindow('search-1')

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        })
      })
    )
  })

  it('removes the load listener when the search window load wait times out', async () => {
    const service = new SearchService()
    const resultPromise = service.openUrlInSearchWindow('search-1', 'https://example.com')

    await vi.waitFor(() => expect(window.webContents.listenerCount('did-finish-load')).toBe(1))
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(resultPromise).resolves.toBe('<html></html>')
    expect(window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    window.webContents.emit('did-finish-load')
    expect(vi.getTimerCount()).toBe(0)
  })
})
