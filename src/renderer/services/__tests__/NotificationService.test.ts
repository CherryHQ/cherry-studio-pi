import type { Notification } from '@renderer/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMultiple: vi.fn(),
  queueAdd: vi.fn(),
  queueClear: vi.fn(),
  ipcOn: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    getMultiple: mocks.getMultiple
  }
}))

vi.mock('../../queue/NotificationQueue', () => ({
  notificationQueue: {
    add: mocks.queueAdd,
    clear: mocks.queueClear,
    pending: 0
  }
}))

const updateNotification: Notification = {
  id: 'update-1',
  type: 'info',
  title: 'Update available',
  message: 'New version',
  timestamp: 1,
  source: 'update'
}

const listenerKey = '__CHERRY_STUDIO_PI_NOTIFICATION_CLICK_HANDLER__'

describe('NotificationService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>)[listenerKey]
    mocks.ipcOn.mockReturnValue(mocks.removeListener)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: mocks.ipcOn
        }
      }
    })
  })

  it('honors the update notification preference instead of filtering update events out', async () => {
    mocks.getMultiple.mockResolvedValue({
      assistant: false,
      backup: false,
      knowledge: false,
      update: true
    })

    const { notificationService } = await import('../NotificationService')
    await notificationService.send(updateNotification)

    expect(mocks.getMultiple).toHaveBeenCalledWith({
      assistant: 'app.notification.assistant.enabled',
      backup: 'app.notification.backup.enabled',
      knowledge: 'app.notification.knowledge.enabled',
      update: 'app.notification.update.enabled'
    })
    expect(mocks.queueAdd).toHaveBeenCalledWith(updateNotification)
  })

  it('does not enqueue disabled update notifications', async () => {
    mocks.getMultiple.mockResolvedValue({
      assistant: false,
      backup: false,
      knowledge: false,
      update: false
    })

    const { notificationService } = await import('../NotificationService')
    await notificationService.send(updateNotification)

    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it('registers the notification click listener only once', async () => {
    await import('../NotificationService')
    await import('../NotificationService')

    expect(mocks.ipcOn).toHaveBeenCalledTimes(1)
    expect(mocks.ipcOn).toHaveBeenCalledWith('notification-click', expect.any(Function))
  })

  it('unregisters the notification click listener and allows fresh registration', async () => {
    const { registerNotificationClickHandler, unregisterNotificationClickHandler } = await import(
      '../NotificationService'
    )

    expect(mocks.ipcOn).toHaveBeenCalledTimes(1)

    unregisterNotificationClickHandler()

    expect(mocks.removeListener).toHaveBeenCalledTimes(1)
    expect((globalThis as Record<string, unknown>)[listenerKey]).toBeUndefined()

    registerNotificationClickHandler()

    expect(mocks.ipcOn).toHaveBeenCalledTimes(2)
  })
})
