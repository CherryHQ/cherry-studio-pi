import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'

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

  try {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(IpcChannel.DataSync_LocalStorageV2Changed, message)
      }
    }
  } catch {
    // Auto-sync triggers are best-effort; the original write must not fail because no window can receive it.
  }
}
