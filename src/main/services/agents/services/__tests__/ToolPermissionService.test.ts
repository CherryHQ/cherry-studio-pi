import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWindowsByType: vi.fn(),
  webContentsSend: vi.fn(),
  ipcHandle: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((serviceName: string) => {
      if (serviceName === 'WindowManager') {
        return { getWindowsByType: mocks.getWindowsByType }
      }
      throw new Error(`Unexpected service: ${serviceName}`)
    })
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.ipcHandle
  }
}))

import { IpcChannel } from '@shared/IpcChannel'

import { promptForToolApproval } from '../ToolPermissionService'

describe('ToolPermissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWindowsByType.mockReturnValue([
      {
        webContents: {
          send: mocks.webContentsSend
        }
      }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not keep the main process alive for pending permission prompts', async () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as NodeJS.Timeout
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)
    const controller = new AbortController()

    const promise = promptForToolApproval(
      'filesystem.read',
      { path: '/tmp/project' },
      {
        signal: controller.signal,
        toolCallId: 'tool-call-1',
        timeoutMs: 12_345
      }
    )

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12_345)
    expect(unref).toHaveBeenCalledTimes(1)
    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      IpcChannel.AgentToolPermission_Request,
      expect.objectContaining({
        toolName: 'filesystem.read',
        toolCallId: 'tool-call-1',
        input: { path: '/tmp/project' }
      })
    )

    controller.abort()

    await expect(promise).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool request aborted before user decision'
    })
  })
})
