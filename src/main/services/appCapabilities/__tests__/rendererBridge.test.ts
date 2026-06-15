import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

import { callRendererBridge } from '../rendererBridge'

function createWindow(executeJavaScript: ReturnType<typeof vi.fn>) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      executeJavaScript,
      isDestroyed: vi.fn(() => false)
    }
  }
}

describe('app capability renderer bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the first responsive bridge without waiting for earlier unresponsive windows', async () => {
    const unresponsiveWindow = createWindow(vi.fn(() => new Promise(() => undefined)))
    const responsiveWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        return 'called'
      })
    )
    mocks.getAllWindows.mockReturnValue([unresponsiveWindow, responsiveWindow])

    await expect(callRendererBridge('test.bridge')).resolves.toBe('called')

    expect(responsiveWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window["test.bridge"]()')
  })

  it('skips destroyed windows before probing renderer bridges', async () => {
    const destroyedWindow = createWindow(vi.fn())
    destroyedWindow.isDestroyed.mockReturnValue(true)
    const responsiveWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        return 'called'
      })
    )
    mocks.getAllWindows.mockReturnValue([destroyedWindow, responsiveWindow])

    await expect(callRendererBridge('test.bridge')).resolves.toBe('called')

    expect(destroyedWindow.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('tries another renderer bridge when a probed bridge fails during the actual call', async () => {
    const failingWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        throw new Error('renderer is navigating')
      })
    )
    const responsiveWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        return 'called'
      })
    )
    mocks.getAllWindows.mockReturnValue([failingWindow, responsiveWindow])

    await expect(callRendererBridge('test.bridge')).resolves.toBe('called')

    expect(failingWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window["test.bridge"]()')
    expect(responsiveWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window["test.bridge"]()')
  })

  it('reuses the last successful bridge window on repeated calls', async () => {
    const cachedWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        return 'called'
      })
    )
    const otherWindow = createWindow(
      vi.fn(async (script: string) => {
        if (script.includes('typeof')) return true
        return 'other'
      })
    )
    mocks.getAllWindows.mockReturnValue([cachedWindow, otherWindow])

    await expect(callRendererBridge('test.cached')).resolves.toBe('called')

    cachedWindow.webContents.executeJavaScript.mockClear()
    otherWindow.webContents.executeJavaScript.mockClear()

    await expect(callRendererBridge('test.cached')).resolves.toBe('called')

    expect(cachedWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      'typeof window["test.cached"] === \'function\''
    )
    expect(cachedWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window["test.cached"]()')
    expect(otherWindow.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('falls back to another bridge window when the cached window stops responding', async () => {
    vi.useFakeTimers()
    try {
      const cachedWindow = createWindow(
        vi.fn(async (script: string) => {
          if (script.includes('typeof')) return true
          return 'cached'
        })
      )
      const otherWindow = createWindow(
        vi.fn(async (script: string) => {
          if (script.includes('typeof')) return true
          return 'other'
        })
      )
      mocks.getAllWindows.mockReturnValue([cachedWindow, otherWindow])

      await expect(callRendererBridge('test.cached.fallback')).resolves.toBe('cached')

      cachedWindow.webContents.executeJavaScript.mockImplementation(() => new Promise(() => undefined))
      otherWindow.webContents.executeJavaScript.mockClear()

      const result = callRendererBridge('test.cached.fallback')
      await vi.advanceTimersByTimeAsync(51)

      await expect(result).resolves.toBe('other')
      expect(otherWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        'typeof window["test.cached.fallback"] === \'function\''
      )
      expect(otherWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window["test.cached.fallback"]()')
    } finally {
      vi.useRealTimers()
    }
  })
})
