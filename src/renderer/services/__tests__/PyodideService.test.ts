import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workerMock = vi.hoisted(() => {
  class MockPyodideWorker {
    static instances: MockPyodideWorker[] = []

    onmessage: ((event: MessageEvent) => void) | null = null
    postedMessages: unknown[] = []
    terminated = false
    private listeners = new Set<(event: MessageEvent) => void>()

    constructor() {
      MockPyodideWorker.instances.push(this)
    }

    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === 'message') this.listeners.add(listener)
    }

    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === 'message') this.listeners.delete(listener)
    }

    postMessage(message: unknown) {
      this.postedMessages.push(message)
    }

    terminate() {
      this.terminated = true
      this.listeners.clear()
    }

    emit(data: unknown) {
      if (this.terminated) return

      const event = { data } as MessageEvent
      this.onmessage?.(event)
      for (const listener of [...this.listeners]) listener(event)
    }

    listenerCount() {
      return this.listeners.size
    }
  }

  return { MockPyodideWorker }
})

vi.mock('../../workers/pyodide.worker?worker', () => ({
  default: workerMock.MockPyodideWorker
}))

const ipcListenerKey = '__CHERRY_STUDIO_PI_PYODIDE_IPC_HANDLER__'

describe('PyodideService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    workerMock.MockPyodideWorker.instances = []
    vi.resetModules()
    delete (globalThis as Record<string, unknown>)[ipcListenerKey]
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined
    })
  })

  afterEach(async () => {
    const { pyodideService } = await import('../PyodideService')
    pyodideService.terminate()
    delete (globalThis as Record<string, unknown>)[ipcListenerKey]
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined
    })
    vi.useRealTimers()
  })

  it('terminates the worker when initialization times out', async () => {
    const { pyodideService } = await import('../PyodideService')

    const resultPromise = pyodideService.runScript('print("hello")')
    await vi.dynamicImportSettled()

    const worker = workerMock.MockPyodideWorker.instances[0]
    expect(worker).toBeDefined()
    expect(worker.listenerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(30_000)

    await expect(resultPromise).resolves.toEqual({
      text: 'Initialization failed: Pyodide initialization timeout'
    })
    expect(worker.terminated).toBe(true)
    expect(worker.listenerCount()).toBe(0)
  })

  it('terminates the worker when Python execution times out', async () => {
    const { pyodideService } = await import('../PyodideService')

    const resultPromise = pyodideService.runScript('while True: pass', {}, 1_000)
    await vi.dynamicImportSettled()

    const worker = workerMock.MockPyodideWorker.instances[0]
    expect(worker).toBeDefined()
    worker.emit({ type: 'initialized' })

    await vi.waitFor(() => expect(worker.postedMessages).toHaveLength(1))

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(resultPromise).resolves.toEqual({
      text: 'Internal error: Python execution timed out'
    })
    expect(worker.terminated).toBe(true)
  })

  it('registers the Python execution IPC handler once and responds through IPC', async () => {
    let requestHandler:
      | ((
          _event: unknown,
          request: { id: string; script: string; context: Record<string, unknown>; timeout: number }
        ) => void)
      | undefined
    const onMock = vi.fn((channel: string, handler: typeof requestHandler) => {
      if (channel === IpcChannel.Python_ExecutionRequest) requestHandler = handler
      return vi.fn()
    })
    const sendMock = vi.fn()

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: onMock,
          send: sendMock
        }
      }
    })

    const module = await import('../PyodideService')
    module.registerPyodideIpcHandler()

    expect(onMock).toHaveBeenCalledTimes(1)
    expect(onMock).toHaveBeenCalledWith(IpcChannel.Python_ExecutionRequest, expect.any(Function))

    requestHandler?.(null, {
      id: 'request-1',
      script: 'print("hello")',
      context: {},
      timeout: 1_000
    })
    await vi.dynamicImportSettled()

    const worker = workerMock.MockPyodideWorker.instances[0]
    expect(worker).toBeDefined()
    worker.emit({ type: 'initialized' })

    await vi.waitFor(() => expect(worker.postedMessages).toHaveLength(1))
    const posted = worker.postedMessages[0] as { id: string }
    worker.emit({
      id: posted.id,
      output: {
        result: null,
        text: 'hello',
        error: null
      }
    })

    await vi.waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(IpcChannel.Python_ExecutionResponse, {
        id: 'request-1',
        result: 'hello'
      })
    )

    module.registerPyodideIpcHandler()

    expect(onMock).toHaveBeenCalledTimes(1)
  })
})
