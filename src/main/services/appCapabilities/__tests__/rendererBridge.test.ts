import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

import { callRendererBridge, getBridgeErrorMessage } from '../rendererBridge'

function createWindow(executeJavaScript: ReturnType<typeof vi.fn>) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      executeJavaScript,
      isDestroyed: vi.fn(() => false)
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('app capability renderer bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redacts sensitive values from bridge error messages', () => {
    const message = getBridgeErrorMessage(
      new Error(
        'Execution failed: window["settings.update"]({"webdavPass":"MSCGBE7IKGONGZYS","apiKey":"sk-secret","private_key":"-----BEGIN PRIVATE KEY-----","tokenCount":42,"passage":"visible"}) Authorization: Bearer raw-token'
      )
    )

    expect(message).not.toContain('MSCGBE7IKGONGZYS')
    expect(message).not.toContain('sk-secret')
    expect(message).not.toContain('BEGIN PRIVATE KEY')
    expect(message).not.toContain('raw-token')
    expect(message).toContain('"webdavPass":"[redacted]"')
    expect(message).toContain('"apiKey":"[redacted]"')
    expect(message).toContain('"private_key":"[redacted]"')
    expect(message).toContain('"tokenCount":42')
    expect(message).toContain('"passage":"visible"')
    expect(message).toContain('Authorization: Bearer [redacted]')
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

  it('does not replay a timed-out actual bridge call on another window', async () => {
    vi.useFakeTimers()
    try {
      const slowCallWindow = createWindow(
        vi.fn((script: string) => {
          if (script.includes('typeof')) return Promise.resolve(true)
          return new Promise(() => undefined)
        })
      )
      const otherWindow = createWindow(
        vi.fn(async (script: string) => {
          if (script.includes('typeof')) return true
          return 'other'
        })
      )
      mocks.getAllWindows.mockReturnValue([slowCallWindow, otherWindow])

      const result = callRendererBridge('test.write.timeout', { write: true }, { timeoutMs: 5_000 })
      const expectation = expect(result).rejects.toThrow('Timed out calling the main window bridge')
      await vi.advanceTimersByTimeAsync(5_001)

      await expectation
      expect(slowCallWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        'window["test.write.timeout"]({"write":true})'
      )
      expect(otherWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        'typeof window["test.write.timeout"] === \'function\''
      )
      expect(otherWindow.webContents.executeJavaScript).not.toHaveBeenCalledWith(
        'window["test.write.timeout"]({"write":true})'
      )
    } finally {
      vi.useRealTimers()
    }
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

  it('does not execute a slow cached bridge call after another window handles the request', async () => {
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

      await expect(callRendererBridge('test.cached.no-duplicate', { write: true })).resolves.toBe('cached')

      const cachedProbe = deferred<boolean>()
      cachedWindow.webContents.executeJavaScript.mockClear()
      otherWindow.webContents.executeJavaScript.mockClear()
      cachedWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
        if (script.includes('typeof')) return cachedProbe.promise
        return Promise.resolve('cached-side-effect')
      })

      const result = callRendererBridge('test.cached.no-duplicate', { write: true })
      await vi.advanceTimersByTimeAsync(51)

      await expect(result).resolves.toBe('other')

      cachedProbe.resolve(true)
      await Promise.resolve()
      await Promise.resolve()

      expect(cachedWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        'typeof window["test.cached.no-duplicate"] === \'function\''
      )
      expect(cachedWindow.webContents.executeJavaScript).not.toHaveBeenCalledWith(
        'window["test.cached.no-duplicate"]({"write":true})'
      )
      expect(otherWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        'window["test.cached.no-duplicate"]({"write":true})'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts renderer bridge waits when the caller signal is cancelled', async () => {
    vi.useFakeTimers()
    try {
      const unresponsiveWindow = createWindow(vi.fn(() => new Promise(() => undefined)))
      mocks.getAllWindows.mockReturnValue([unresponsiveWindow])
      const controller = new AbortController()

      const result = callRendererBridge('test.abort', undefined, {
        checkTimeoutMs: 5_000,
        timeoutMs: 5_000,
        signal: controller.signal
      })

      controller.abort(new Error('agent cancelled bridge call'))
      await expect(result).rejects.toThrow('agent cancelled bridge call')
      await vi.advanceTimersByTimeAsync(5_000)
    } finally {
      vi.useRealTimers()
    }
  })
})
