import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createState = () => ({
  assistants: {},
  backup: {},
  codeTools: {},
  copilot: {},
  inputTools: {},
  knowledge: {},
  llm: {},
  mcp: {},
  memory: {},
  minapps: {},
  note: {},
  nutstore: {},
  ocr: {},
  openclaw: {},
  paintings: {},
  preprocess: {},
  selectionStore: {},
  settings: { language: 'zh-CN' },
  shortcuts: {},
  translate: {},
  websearch: {}
})

const createEmptyRuntimeState = () => ({
  ...createState(),
  settings: {}
})

describe('StorageV2MirrorService', () => {
  let importLegacyReduxSnapshot: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    importLegacyReduxSnapshot = vi.fn().mockResolvedValue({ dryRun: false })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('waits for startup hydration flow instead of mirroring persisted cache on REHYDRATE', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    middleware({ type: 'persist/REHYDRATE' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    middleware({ type: 'settings/setLanguage' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('pauses startup mirror work until runtime hydration is complete', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    storageV2MirrorService.pauseRuntimeMirroring()
    middleware({ type: 'settings/setLanguage' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    storageV2MirrorService.resumeRuntimeMirroring()
    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('can queue the latest paused runtime state when mirroring resumes', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    storageV2MirrorService.pauseRuntimeMirroring()
    middleware({ type: 'knowledge/deleteBase' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    storageV2MirrorService.resumeRuntimeMirroring({ scheduleLatest: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('keeps the initial startup mirror non-pruning', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('does not prune Storage v2 with an empty startup runtime snapshot', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createEmptyRuntimeState)
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {},
        redux: expect.objectContaining({
          note: {}
        })
      }),
      { dryRun: false, pruneMissing: false, protectExistingFromDefaults: true }
    )
  })

  it('does not rewrite an identical runtime snapshot just to prune missing data', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)

    middleware({ type: 'settings/setLanguage' })

    await vi.advanceTimersByTimeAsync(1500)
    expect(importLegacyReduxSnapshot).toHaveBeenNthCalledWith(1, expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('retries a failed startup mirror without upgrading it to pruning', async () => {
    importLegacyReduxSnapshot.mockRejectedValueOnce(new Error('ipc unavailable')).mockResolvedValueOnce({
      dryRun: false
    })
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(2)
    expect(importLegacyReduxSnapshot).toHaveBeenNthCalledWith(1, expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
    expect(importLegacyReduxSnapshot).toHaveBeenNthCalledWith(2, expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('rejects strict flushes when the Redux mirror is still pending after failure', async () => {
    importLegacyReduxSnapshot.mockRejectedValueOnce(new Error('ipc unavailable'))
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createState)

    await expect(storageV2MirrorService.flushStrict()).rejects.toThrow('ipc unavailable')
    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('rejects strict flushes when Storage v2 API is unavailable with pending Redux work', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createState)

    await expect(storageV2MirrorService.flushStrict()).rejects.toThrow(
      'Storage v2 API unavailable while Redux settings mirror work is pending'
    )
  })

  it('retries pending Redux mirror work when Storage v2 API becomes available later', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')

    storageV2MirrorService.scheduleStartupMirror(createState)
    await storageV2MirrorService.flush()

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          importLegacyReduxSnapshot
        }
      }
    })

    await vi.advanceTimersByTimeAsync(1199)
    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('does not keep retrying after the renderer window has been torn down', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    storageV2MirrorService.scheduleStartupMirror(createState)

    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await storageV2MirrorService.flush()
      await vi.advanceTimersByTimeAsync(1500)
    } finally {
      vi.stubGlobal('window', originalWindow)
    }

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()
    expect(storageV2MirrorService.getStatus().pendingCount).toBe(1)
  })

  it('flushes high-value settings actions without waiting for debounce', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    middleware({ type: 'settings/setS3Partial' })

    await vi.waitFor(() => {
      expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    })
    expect(importLegacyReduxSnapshot).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: true
    })
  })

  it('lets explicit WebDAV config actions overwrite startup-protected defaults', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)

    middleware({ type: 'settings/setDataSyncWebdavHost' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(2)
    expect(importLegacyReduxSnapshot).toHaveBeenNthCalledWith(2, expect.any(Object), {
      dryRun: false,
      pruneMissing: false,
      protectExistingFromDefaults: false
    })
  })

  it('does not mirror runtime hydration actions restored from sync', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    middleware({ type: 'settings/hydrate', payload: { language: 'en-US' }, meta: { fromSync: true } })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).not.toHaveBeenCalled()

    middleware({ type: 'settings/setLanguage' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
  })

  it('flushes persisted redux configuration slices without waiting for debounce', async () => {
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const middleware = storageV2MirrorService.createMiddleware()({
      dispatch: vi.fn(),
      getState: createState
    } as any)(vi.fn((action) => action))

    middleware({ type: 'minApps/setPinnedMinApps' })

    await vi.waitFor(() => {
      expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    })
  })

  it('signals data sync after a successful Redux mirror write', async () => {
    const events: string[] = []
    const { subscribeDataSyncLocalChanges } = await import('../DataSyncLocalChangeSignal')
    const { storageV2MirrorService } = await import('../StorageV2MirrorService')
    const unsubscribe = subscribeDataSyncLocalChanges((event) => {
      events.push(event.reason)
    })

    storageV2MirrorService.scheduleStartupMirror(createState)
    await vi.advanceTimersByTimeAsync(1500)

    expect(importLegacyReduxSnapshot).toHaveBeenCalledTimes(1)
    expect(events).toContain('redux')
    unsubscribe()
  })
})
