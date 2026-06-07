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
})
