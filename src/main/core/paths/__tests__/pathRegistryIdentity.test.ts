import { afterEach, describe, expect, it, vi } from 'vitest'

const getPathMock = vi.fn((key: string) => {
  const paths: Record<string, string> = {
    appData: '/mock/appData',
    crashDumps: '/mock/crashDumps',
    desktop: '/mock/desktop',
    documents: '/mock/documents',
    downloads: '/mock/downloads',
    exe: '/mock/install/CherryStudioPi',
    logs: '/mock/logs',
    music: '/mock/music',
    pictures: '/mock/pictures',
    sessionData: '/mock/sessionData',
    temp: '/mock/temp',
    userData: '/mock/userData',
    videos: '/mock/videos'
  }
  return paths[key] ?? `/mock/${key}`
})

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('@main/core/platform')
  getPathMock.mockClear()
})

describe('pathRegistry app identity paths', () => {
  it('uses the Cherry Studio Pi temp root for app-owned temporary files', async () => {
    vi.doMock('electron', () => ({
      app: {
        getAppPath: () => '/mock/app',
        getPath: getPathMock,
        isPackaged: false
      }
    }))
    vi.doMock('@main/core/platform', () => ({
      isMac: false,
      isWin: false
    }))

    const { buildPathRegistry } = await import('../pathRegistry')
    const registry = buildPathRegistry()

    expect(registry['app.temp']).toBe('/mock/temp/CherryStudioPi')
    expect(registry['feature.backup.temp']).toBe('/mock/temp/CherryStudioPi/backup')
  })
})
