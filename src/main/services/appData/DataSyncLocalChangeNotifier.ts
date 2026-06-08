import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('DataSyncLocalChangeNotifier')

export type MainProcessDataSyncLocalChangeReason = 'storage-v2' | 'file'

export function notifyMainProcessDataSyncLocalChange(
  reason: MainProcessDataSyncLocalChangeReason,
  payload: Record<string, unknown> = {}
) {
  const message = {
    reason,
    changedAt: Date.now(),
    ...payload
  }

  let browserWindows: BrowserWindow[]
  try {
    browserWindows = BrowserWindow.getAllWindows()
  } catch (error) {
    logger.warn('Failed to enumerate windows for data sync local change notification', error as Error)
    return
  }

  for (const browserWindow of browserWindows) {
    if (browserWindow.isDestroyed()) continue

    try {
      browserWindow.webContents.send(IpcChannel.DataSync_LocalStorageV2Changed, message)
    } catch (error) {
      logger.warn('Failed to notify a window about data sync local change', error as Error)
    }
  }
}
