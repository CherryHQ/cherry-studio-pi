import type { Notification } from '@renderer/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMultiple: vi.fn(),
  queueAdd: vi.fn(),
  queueClear: vi.fn(),
  ipcOn: vi.fn()
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

describe('NotificationService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
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
})
