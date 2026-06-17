import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    warn: vi.fn()
  },
  getAllWindows: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

import { IpcChannel } from '@shared/IpcChannel'

import { notifyMainProcessDataSyncLocalChange } from '../DataSyncLocalChangeNotifier'

function createWindow(send: ReturnType<typeof vi.fn>, destroyed = false, webContentsDestroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      send,
      isDestroyed: vi.fn(() => webContentsDestroyed)
    }
  }
}

describe('DataSyncLocalChangeNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('continues notifying other windows when one renderer send fails', () => {
    const failingSend = vi.fn(() => {
      throw new Error('send failed')
    })
    const healthySend = vi.fn()
    mocks.getAllWindows.mockReturnValueOnce([createWindow(failingSend), createWindow(healthySend)])

    notifyMainProcessDataSyncLocalChange('storage-v2', { entityType: 'agent' })

    expect(failingSend).toHaveBeenCalledTimes(1)
    expect(healthySend).toHaveBeenCalledWith(
      IpcChannel.DataSync_LocalStorageV2Changed,
      expect.objectContaining({
        reason: 'storage-v2',
        entityType: 'agent'
      })
    )
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to notify a window about data sync local change',
      expect.objectContaining({ message: 'send failed' })
    )
  })

  it('skips windows whose webContents has already been destroyed', () => {
    const destroyedWebContentsSend = vi.fn()
    const healthySend = vi.fn()
    mocks.getAllWindows.mockReturnValueOnce([
      createWindow(destroyedWebContentsSend, false, true),
      createWindow(healthySend)
    ])

    notifyMainProcessDataSyncLocalChange('file', { fileId: 'file-1' })

    expect(destroyedWebContentsSend).not.toHaveBeenCalled()
    expect(healthySend).toHaveBeenCalledWith(
      IpcChannel.DataSync_LocalStorageV2Changed,
      expect.objectContaining({
        reason: 'file',
        fileId: 'file-1'
      })
    )
  })
})
