import { preferenceService } from '@data/PreferenceService'
import type { Notification } from '@renderer/types/notification'

import { notificationQueue } from '../queue/NotificationQueue'

const NOTIFICATION_CLICK_HANDLER_KEY = '__CHERRY_STUDIO_PI_NOTIFICATION_CLICK_HANDLER__'

export class NotificationService {
  private queue = notificationQueue

  constructor() {
    this.setupNotificationClickHandler()
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
   * 设置通知点击事件处理
   */
  private setupNotificationClickHandler(): void {
    const ipcRenderer = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined
    if (!ipcRenderer) return

    const globalState = globalThis as Record<string, unknown>
    if (globalState[NOTIFICATION_CLICK_HANDLER_KEY]) return
    globalState[NOTIFICATION_CLICK_HANDLER_KEY] = true

    // Register an event listener for notification clicks
    ipcRenderer.on('notification-click', (_event, notification: Notification) => {
      // 根据通知类型处理点击事件
      if (notification.type === 'action') {
        notification.onClick?.()
      }
    })
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
