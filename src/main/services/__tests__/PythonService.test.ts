import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.applicationGet
  }
}))

vi.mock('@main/core/window/types', () => ({
  WindowType: {
    Main: 'main'
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    Python_Execute: 'python:execute',
    Python_ExecutionRequest: 'python:execution-request',
    Python_ExecutionResponse: 'python:execution-response'
  }
}))

async function createService() {
  const { PythonService } = await import('../PythonService')
  return new PythonService()
}

describe('PythonService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects immediately and clears pending requests when renderer dispatch fails', async () => {
    vi.useFakeTimers()
    const service = await createService()
    const windowManager = {
      getWindowsByType: vi.fn(() => [{}]),
      broadcastToType: vi.fn(() => {
        throw new Error('window is gone')
      })
    }

    mocks.applicationGet.mockReturnValue(windowManager)

    await expect(service.executeScript('print("hello")')).rejects.toThrow(
      'Failed to send Python execution request: window is gone'
    )

    expect(windowManager.broadcastToType).toHaveBeenCalledWith(
      'main',
      'python:execution-request',
      expect.objectContaining({
        script: 'print("hello")'
      })
    )
    expect((service as any).pendingRequests.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
