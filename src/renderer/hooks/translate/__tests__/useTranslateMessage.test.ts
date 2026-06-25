import { TranslationOverlaySetterProvider } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcRequest, ipcOn } = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  ipcOn: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequest,
    on: ipcOn
  }
}))

import { useTranslateMessage } from '../useTranslateMessage'

/**
 * Regression: rendered with NO `TranslationOverlaySetterProvider` ancestor
 * (the agent-session / quick-assistant case), the hook must not throw and
 * `translate` must be a safe no-op.
 */
describe('useTranslateMessage', () => {
  const translateOpen = vi.fn()

  beforeEach(() => {
    translateOpen.mockResolvedValue(undefined)
    ipcRequest.mockResolvedValue(undefined)
    ipcOn.mockReturnValue(vi.fn())

    vi.stubGlobal('window', {
      api: {
        translate: { open: translateOpen }
      }
    } as unknown as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('mounts without throwing', () => {
    expect(() => renderHook(() => useTranslateMessage('msg-1'))).not.toThrow()
  })

  it('translate() is a no-op when no overlay sink is mounted', async () => {
    const { result } = renderHook(() => useTranslateMessage('msg-1'))

    await act(async () => {
      await result.current.translate('hello', { langCode: 'en-us' } as never)
    })

    expect(translateOpen).not.toHaveBeenCalled()
  })

  it('clears the overlay and subscriptions immediately when cancelling an active translation', async () => {
    const setOverlay = vi.fn()
    const unsubChunk = vi.fn()
    const unsubDone = vi.fn()
    const unsubError = vi.fn()
    ipcOn.mockReset()
    ipcOn.mockReturnValueOnce(unsubChunk).mockReturnValueOnce(unsubDone).mockReturnValueOnce(unsubError)

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(TranslationOverlaySetterProvider, { value: setOverlay }, children)
    const { result } = renderHook(() => useTranslateMessage('msg-1'), { wrapper })

    await act(async () => {
      await result.current.translate('hello', { langCode: 'en-us' } as never)
    })

    expect(setOverlay).toHaveBeenCalledWith('msg-1', { content: '', targetLanguage: 'en-us' })

    act(() => {
      result.current.cancel()
    })

    const streamId = translateOpen.mock.calls[0][0].streamId
    expect(ipcRequest).toHaveBeenCalledWith('ai.stream_abort', { topicId: streamId })
    expect(setOverlay).toHaveBeenLastCalledWith('msg-1', null)
    expect(unsubChunk).toHaveBeenCalledOnce()
    expect(unsubDone).toHaveBeenCalledOnce()
    expect(unsubError).toHaveBeenCalledOnce()
  })
})
