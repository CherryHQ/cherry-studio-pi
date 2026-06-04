export const DATA_SYNC_LOCAL_CHANGE_EVENT = 'cherry-studio-pi:data-sync-local-change'

export type DataSyncLocalChangeReason =
  | 'redux'
  | 'conversation'
  | 'file'
  | 'agent'
  | 'assistant'
  | 'provider'
  | 'dexie-settings'
  | 'dexie-table'
  | 'local-storage'

export type DataSyncLocalChangeEvent = {
  reason: DataSyncLocalChangeReason
  changedAt: number
}

let notificationSuppressionDepth = 0

function createLocalChangeEvent(detail: DataSyncLocalChangeEvent) {
  const eventConstructor = typeof window !== 'undefined' ? window.CustomEvent : globalThis.CustomEvent

  if (typeof eventConstructor === 'function') {
    return new eventConstructor<DataSyncLocalChangeEvent>(DATA_SYNC_LOCAL_CHANGE_EVENT, { detail })
  }

  const event = new Event(DATA_SYNC_LOCAL_CHANGE_EVENT) as CustomEvent<DataSyncLocalChangeEvent>
  Object.defineProperty(event, 'detail', {
    configurable: true,
    value: detail
  })
  return event
}

export function notifyDataSyncLocalChange(reason: DataSyncLocalChangeReason) {
  if (notificationSuppressionDepth > 0) return
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return

  window.dispatchEvent(
    createLocalChangeEvent({
      reason,
      changedAt: Date.now()
    })
  )
}

export function subscribeDataSyncLocalChanges(listener: (event: DataSyncLocalChangeEvent) => void) {
  if (
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function' ||
    typeof window.removeEventListener !== 'function'
  ) {
    return () => undefined
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<DataSyncLocalChangeEvent>).detail
    if (!detail?.reason) return
    listener(detail)
  }

  window.addEventListener(DATA_SYNC_LOCAL_CHANGE_EVENT, handler)

  return () => {
    window.removeEventListener(DATA_SYNC_LOCAL_CHANGE_EVENT, handler)
  }
}

export async function suppressDataSyncLocalChangeNotifications<T>(callback: () => Promise<T>): Promise<T> {
  notificationSuppressionDepth += 1
  try {
    return await callback()
  } finally {
    notificationSuppressionDepth = Math.max(0, notificationSuppressionDepth - 1)
  }
}
