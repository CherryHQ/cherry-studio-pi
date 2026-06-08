import { IpcChannel } from '@shared/IpcChannel'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: mocks.ipcMain
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

import { IpcAdapter } from '../IpcAdapter'

function getDataApiHandler() {
  const handler = mocks.ipcMain.handle.mock.calls.find(([channel]) => channel === IpcChannel.DataApi_Request)?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Data API IPC handler was not registered')
  }
  return handler as (_event: unknown, request: unknown) => Promise<unknown>
}

describe('IpcAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a bad request response for malformed IPC requests', async () => {
    const apiServer = {
      handleRequest: vi.fn()
    }
    new IpcAdapter(apiServer as never).setup()

    const response = await getDataApiHandler()({}, null)

    expect(apiServer.handleRequest).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      id: 'malformed-data-api-request',
      status: 400,
      error: {
        code: 'BAD_REQUEST',
        status: 400,
        message: 'Malformed Data API request'
      }
    })
  })

  it('uses the incoming id when rejecting a malformed request shape', async () => {
    const apiServer = {
      handleRequest: vi.fn()
    }
    new IpcAdapter(apiServer as never).setup()

    const response = await getDataApiHandler()({}, { id: 'request-1', method: 'NOPE', path: '/topics' })

    expect(apiServer.handleRequest).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      id: 'request-1',
      status: 400,
      error: {
        code: 'BAD_REQUEST'
      }
    })
  })
})
