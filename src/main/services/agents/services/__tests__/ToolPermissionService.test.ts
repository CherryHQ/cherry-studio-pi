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
        isDestroyed: vi.fn(() => false),
        webContents: {
          isDestroyed: vi.fn(() => false),
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

  it('settles permission prompts if the abort signal fires while the prompt is being registered', async () => {
    const controller = new AbortController()
    const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      originalAddEventListener(type, listener, options)
      if (type === 'abort') {
        controller.abort()
      }
    }) as AbortSignal['addEventListener'])

    await expect(
      promptForToolApproval(
        'filesystem.write',
        { path: '/tmp/project/file.txt' },
        {
          signal: controller.signal,
          toolCallId: 'tool-call-abort-race',
          timeoutMs: 12_345
        }
      )
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool request aborted before user decision'
    })

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      IpcChannel.AgentToolPermission_Result,
      expect.objectContaining({
        reason: 'aborted',
        toolCallId: 'tool-call-abort-race'
      })
    )
    expect(mocks.webContentsSend).not.toHaveBeenCalledWith(
      IpcChannel.AgentToolPermission_Request,
      expect.objectContaining({ toolCallId: 'tool-call-abort-race' })
    )
  })

  it('settles permission prompts when the renderer window rejects IPC sends', async () => {
    mocks.webContentsSend.mockImplementation(() => {
      throw new Error('window is gone')
    })

    await expect(
      promptForToolApproval(
        'filesystem.read',
        { path: '/tmp/project' },
        {
          toolCallId: 'tool-call-2',
          timeoutMs: 12_345
        }
      )
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Unable to request approval because the renderer window is unavailable'
    })

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      IpcChannel.AgentToolPermission_Request,
      expect.objectContaining({ toolCallId: 'tool-call-2' })
    )
    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      IpcChannel.AgentToolPermission_Result,
      expect.objectContaining({
        reason: 'no-window',
        toolCallId: 'tool-call-2'
      })
    )
  })
})
