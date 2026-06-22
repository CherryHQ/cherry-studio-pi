import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderPullReconcile } from '../useProviderPullReconcile'

const { buildPreviewMock, useProviderMock, useProviderApiKeysMock } = vi.hoisted(() => ({
  buildPreviewMock: vi.fn(),
  useProviderMock: vi.fn(),
  useProviderApiKeysMock: vi.fn()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...a: any[]) => useProviderMock(...a),
  useProviderApiKeys: (...a: any[]) => useProviderApiKeysMock(...a)
}))

vi.mock('../../ModelList/buildModelListSyncPreview', () => ({
  buildModelListSyncPreview: (...a: any[]) => buildPreviewMock(...a)
}))

vi.mock('../../ModelList/modelSync', () => ({
  ModelSyncError: class ModelSyncError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (k: string) => k })
}))

const keys = (...values: string[]) => ({
  data: { keys: values.map((key) => ({ key, isEnabled: true })) }
})

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}

describe('useProviderPullReconcile — C3 single-flight by api-key signature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({ provider: { id: 'openai' } })
    window.toast = { success: vi.fn(), error: vi.fn() } as any
  })

  it('dedupes concurrent calls for the same key onto one upstream fetch', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    const d = deferred<any>()
    buildPreviewMock.mockReturnValue(d.promise)

    const { result } = renderHook(() => useProviderPullReconcile('openai'))

    let p1: Promise<any>
    let p2: Promise<any>
    act(() => {
      p1 = result.current.fetchPreview()
      p2 = result.current.fetchPreview()
    })

    expect(buildPreviewMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      d.resolve({ added: [], missing: [] })
      await Promise.all([p1, p2])
    })
  })

  it('does not return the stale promise when the key changes mid-flight; latest key wins', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    const d1 = deferred<any>()
    const d2 = deferred<any>()
    buildPreviewMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)

    const { result, rerender } = renderHook(() => useProviderPullReconcile('openai'))

    let p1: Promise<any>
    act(() => {
      p1 = result.current.fetchPreview()
    })

    // User replaces the key before the first request returns.
    useProviderApiKeysMock.mockReturnValue(keys('sk-2'))
    rerender()

    let p2: Promise<any>
    act(() => {
      p2 = result.current.fetchPreview()
    })

    // K2 must trigger its own fetch — not be deduped onto K1's promise.
    expect(buildPreviewMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      // Stale K1 resolves last; its result must NOT overwrite K2's preview.
      d2.resolve({ added: [{ id: 'k2' }], missing: [] })
      d1.resolve({ added: [{ id: 'k1' }], missing: [] })
      await Promise.all([p1, p2])
    })

    expect(result.current.preview).toEqual({ added: [{ id: 'k2' }], missing: [] })
  })

  it('does not dedupe onto an in-flight preview from another provider with the same key', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-shared'))
    const d1 = deferred<any>()
    const d2 = deferred<any>()
    buildPreviewMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)

    const { result, rerender } = renderHook(({ providerId }) => useProviderPullReconcile(providerId), {
      initialProps: { providerId: 'openai' }
    })

    let p1: Promise<any>
    act(() => {
      p1 = result.current.fetchPreview()
    })

    rerender({ providerId: 'anthropic' })

    let p2: Promise<any>
    act(() => {
      p2 = result.current.fetchPreview()
    })

    expect(buildPreviewMock).toHaveBeenCalledTimes(2)
    expect(buildPreviewMock).toHaveBeenNthCalledWith(1, { providerId: 'openai' })
    expect(buildPreviewMock).toHaveBeenNthCalledWith(2, { providerId: 'anthropic' })

    await act(async () => {
      d2.resolve({ added: [{ id: 'anthropic-model' }], missing: [] })
      d1.resolve({ added: [{ id: 'openai-model' }], missing: [] })
      await Promise.all([p1, p2])
    })

    expect(result.current.preview).toEqual({ added: [{ id: 'anthropic-model' }], missing: [] })
  })

  it('clears an existing preview when the provider changes', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    buildPreviewMock.mockResolvedValue({ added: [{ id: 'openai-model' }], missing: [] })

    const { result, rerender } = renderHook(({ providerId }) => useProviderPullReconcile(providerId), {
      initialProps: { providerId: 'openai' }
    })

    await act(async () => {
      await result.current.fetchPreview()
    })

    expect(result.current.preview).toEqual({ added: [{ id: 'openai-model' }], missing: [] })

    rerender({ providerId: 'anthropic' })

    expect(result.current.preview).toBeNull()
  })

  it('does not surface stale preview failures after unmount', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    const d = deferred<any>()
    buildPreviewMock.mockReturnValue(d.promise)

    const { result, unmount } = renderHook(() => useProviderPullReconcile('openai'))

    let previewPromise: Promise<any>
    act(() => {
      previewPromise = result.current.fetchPreview()
    })
    unmount()

    await act(async () => {
      d.reject(new Error('closed'))
      await previewPromise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('preserves nested preview failure details from bridged errors', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    buildPreviewMock.mockRejectedValue({ error: { message: 'provider upstream timed out' } })

    const { result } = renderHook(() => useProviderPullReconcile('openai'))
    let thrown: unknown

    await act(async () => {
      try {
        await result.current.fetchPreview()
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('provider upstream timed out')
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.sync_pull_failed')
  })
})
