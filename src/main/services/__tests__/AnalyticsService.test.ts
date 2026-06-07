import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyticsClientConstructor: vi.fn(),
  destroy: vi.fn(),
  preferenceGet: vi.fn(),
  subscribeChange: vi.fn(),
  trackAppLaunch: vi.fn(),
  trackAppUpdate: vi.fn(),
  trackTokenUsage: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') {
        return {
          get: mocks.preferenceGet,
          subscribeChange: mocks.subscribeChange
        }
      }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
}))

vi.mock('@cherrystudio/analytics-client', () => ({
  AnalyticsClient: mocks.analyticsClientConstructor.mockImplementation(() => ({
    destroy: mocks.destroy,
    trackAppLaunch: mocks.trackAppLaunch,
    trackAppUpdate: mocks.trackAppUpdate,
    trackTokenUsage: mocks.trackTokenUsage
  }))
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3')
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

import { BaseService } from '@main/core/lifecycle'

import { AnalyticsService } from '../AnalyticsService'

describe('AnalyticsService', () => {
  let service: AnalyticsService

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    mocks.destroy.mockResolvedValue(undefined)
    mocks.preferenceGet.mockReturnValue(true)
    mocks.subscribeChange.mockReturnValue({ dispose: vi.fn() })
    service = new AnalyticsService()
  })

  it('tracks app launch at most once per process across preference reactivation', async () => {
    ;(service as any).onActivate()
    await (service as any).onDeactivate()
    ;(service as any).onActivate()

    expect(mocks.analyticsClientConstructor).toHaveBeenCalledTimes(2)
    expect(mocks.trackAppLaunch).toHaveBeenCalledTimes(1)
    expect(mocks.trackAppLaunch).toHaveBeenCalledWith({ version: '1.2.3', os: process.platform })
  })
})
