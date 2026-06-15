import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMiddleware: vi.fn(() => () => (next: (action: unknown) => unknown) => (action: unknown) => next(action)),
  flushStrict: vi.fn(),
  scheduleStartupMirror: vi.fn()
}))

vi.mock('@renderer/services/StorageV2MirrorService', () => ({
  storageV2MirrorService: {
    createMiddleware: mocks.createMiddleware,
    flushStrict: mocks.flushStrict,
    scheduleStartupMirror: mocks.scheduleStartupMirror
  }
}))

describe('renderer store v2 persistence bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.flushStrict.mockResolvedValue(undefined)
  })

  it('schedules the startup Storage v2 mirror from the Redux state', async () => {
    await import('../index')

    expect(mocks.createMiddleware).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleStartupMirror).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleStartupMirror).toHaveBeenCalledWith(expect.any(Function))
  })

  it('flushes the Storage v2 Redux mirror when legacy save hooks run', async () => {
    const { handleSaveData, persistor } = await import('../index')

    await handleSaveData()
    await persistor.flush()

    expect(mocks.flushStrict).toHaveBeenCalledTimes(2)
  })
})
