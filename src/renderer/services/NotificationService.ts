import { preferenceService } from '@data/PreferenceService'
import type { Notification } from '@renderer/types/notification'

import { notificationQueue } from '../queue/NotificationQueue'

const NOTIFICATION_CLICK_HANDLER_KEY = '__CHERRY_STUDIO_PI_NOTIFICATION_CLICK_HANDLER__'

type NotificationClickHandlerState = {
  remove: () => void
}

type NotificationClickHandlerGlobal = typeof globalThis & {
  [NOTIFICATION_CLICK_HANDLER_KEY]?: boolean | NotificationClickHandlerState
}

export function registerNotificationClickHandler(): void {
  const ipcRenderer = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined
  if (!ipcRenderer) return

  const globalState = globalThis as NotificationClickHandlerGlobal
  if (globalState[NOTIFICATION_CLICK_HANDLER_KEY]) return

  const remove = ipcRenderer.on('notification-click', (_event, notification: Notification) => {
    // 根据通知类型处理点击事件
    if (notification.type === 'action') {
      notification.onClick?.()
    }
  })
  globalState[NOTIFICATION_CLICK_HANDLER_KEY] = { remove }
}

export function unregisterNotificationClickHandler(): void {
  const globalState = globalThis as NotificationClickHandlerGlobal
  const state = globalState[NOTIFICATION_CLICK_HANDLER_KEY]

  if (state && typeof state === 'object') {
    state.remove()
  }

  delete globalState[NOTIFICATION_CLICK_HANDLER_KEY]
}

export class NotificationService {
  private queue = notificationQueue

  constructor() {
    registerNotificationClickHandler()
  }

  /**
   * 发送通知
   * @param notification 要发送的通知
   */
  public async send(notification: Notification): Promise<void> {
    const notificationSettings = await preferenceService.getMultiple({
      assistant: 'app.notification.assistant.enabled',
      backup: 'app.notification.backup.enabled',
      knowledge: 'app.notification.knowledge.enabled',
      update: 'app.notification.update.enabled'
    })

    if (notificationSettings[notification.source]) {
      void this.queue.add(notification)
    }
  }

  /**
   * 清空通知队列
   */
  public clear(): void {
    this.queue.clear()
  }

  /**
   * 获取队列中等待的通知数量
   */
  public get pendingCount(): number {
    return this.queue.pending
  }
}

export const notificationService = new NotificationService()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterNotificationClickHandler()
  })
}
