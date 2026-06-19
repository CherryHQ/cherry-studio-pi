import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderApiKey } from '../useProviderApiKey'

const updateApiKeysMock = vi.fn().mockResolvedValue(undefined)
const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const updateProviderMock = vi.fn().mockResolvedValue(undefined)

let apiKeysData:
  | {
      keys: Array<{ id: string; key: string; isEnabled: boolean; label?: string }>
    }
  | undefined

vi.mock('../../../utils/providerSettingsSideEffects', () => ({
  applyProviderApiKeySideEffects: vi.fn()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

describe('useProviderApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    ;(window as any).toast = {
      error: vi.fn()
    }
    apiKeysData = {
      keys: []
    }
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true }
    })
    useProviderApiKeysMock.mockImplementation(() => ({
      data: apiKeysData
    }))
    useProviderMutationsMock.mockReturnValue({
      updateApiKeys: updateApiKeysMock,
      updateProvider: updateProviderMock
    })
  })

  it('keeps the local api key input when slower server echoes older values', () => {
    const { result, rerender } = renderHook(() => useProviderApiKey('openai'))

    expect(result.current.inputApiKey).toBe('')
    expect(result.current.serverApiKey).toBe('')
    expect(result.current.hasPendingSync).toBe(false)

    act(() => {
      result.current.setInputApiKey('sk-latest')
    })

    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(true)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-partial', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(true)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-latest', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(false)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-remote-change', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-remote-change')
    expect(result.current.serverApiKey).toBe('sk-remote-change')
  })

  it('preserves disabled keys and labels when inline edits update enabled keys', async () => {
    apiKeysData = {
      keys: [
        { id: 'k1', key: 'sk-one', isEnabled: true, label: 'Primary' },
        { id: 'k2', key: 'sk-two', isEnabled: false, label: 'Backup' }
      ]
    }

    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-updated')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysMock.mock.calls[0][0]).toEqual([
      { id: 'k1', key: 'sk-updated', isEnabled: true, label: 'Primary' },
      { id: 'k2', key: 'sk-two', isEnabled: false, label: 'Backup' }
    ])
  })

  it('filters blank and duplicate inline keys before persisting', async () => {
    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-existing', isEnabled: true, label: 'Primary' }]
    }

    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey(' sk-next ,, sk-next ,   ')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysMock.mock.calls[0][0]).toEqual([
      { id: 'k1', key: 'sk-next', isEnabled: true, label: 'Primary' }
    ])
  })

  it('reports autosave failures without clearing pending sync state', async () => {
    updateApiKeysMock.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-failing')
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(window.toast.error).toHaveBeenCalled()
    expect(result.current.inputApiKey).toBe('sk-failing')
    expect(result.current.hasPendingSync).toBe(true)
  })

  it('commits the current input immediately when requested', async () => {
    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-now')
    })

    await act(async () => {
      await result.current.commitInputApiKeyNow()
    })

    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: expect.any(String), key: 'sk-now', isEnabled: true }])
  })

  it('auto-enables a disabled provider after saving an enabled API key', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false }
    })
    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-enabled')
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: expect.any(String), key: 'sk-enabled', isEnabled: true }])
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
  })

  it('flushes pending keys on unmount without showing stale auto-enable failures', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false }
    })
    updateProviderMock.mockRejectedValueOnce(new Error('enable failed'))
    const { result, unmount } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-on-close')
    })

    await act(async () => {
      unmount()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: expect.any(String), key: 'sk-on-close', isEnabled: true }])
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('flushes pending keys to the previous provider before switching providers', async () => {
    const updateApiKeysByProviderMock = vi.fn().mockResolvedValue(undefined)
    useProviderMock.mockImplementation((providerId: string) => ({
      provider: { id: providerId, isEnabled: true }
    }))
    useProviderMutationsMock.mockImplementation((providerId: string) => ({
      updateApiKeys: (entries: unknown) => updateApiKeysByProviderMock(providerId, entries),
      updateProvider: updateProviderMock
    }))

    const { result, rerender } = renderHook(({ providerId }) => useProviderApiKey(providerId), {
      initialProps: { providerId: 'openai' }
    })

    act(() => {
      result.current.setInputApiKey('sk-openai')
    })

    await act(async () => {
      rerender({ providerId: 'anthropic' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateApiKeysByProviderMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysByProviderMock).toHaveBeenCalledWith('openai', [
      { id: expect.any(String), key: 'sk-openai', isEnabled: true }
    ])
  })

  it('does not auto-enable a disabled provider when the enabled key input is empty', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false }
    })
    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-existing', isEnabled: true }]
    }
    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('')
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(updateApiKeysMock).toHaveBeenCalledWith([])
    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('keeps api key input local to each store', () => {
    const first = renderHook(() => useProviderApiKey('openai'))
    const second = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      first.result.current.setInputApiKey('sk-shared')
    })

    expect(second.result.current.inputApiKey).toBe('')
  })
})
