import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import WebviewContainer from '../WebviewContainer'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.spell_check.enabled') return [true]
    if (key === 'feature.mini_app.open_link_external') return [false]
    return [undefined]
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('WebviewContainer', () => {
  function renderContainer(onLoadedCallback = vi.fn()) {
    let webview: HTMLElement | null = null
    const onSetRefCallback = vi.fn((_appid: string, element: HTMLElement | null) => {
      if (!element) return

      webview = element
      vi.spyOn(element, 'addEventListener')
      vi.spyOn(element, 'removeEventListener')
      Object.assign(element, {
        getWebContentsId: vi.fn(() => 42)
      })
    })

    const rendered = render(
      <WebviewContainer
        appid="mini-app"
        url="https://example.com"
        onSetRefCallback={onSetRefCallback as never}
        onLoadedCallback={onLoadedCallback}
        onNavigateCallback={vi.fn()}
      />
    )

    expect(webview).not.toBeNull()

    return {
      ...rendered,
      webview: webview as unknown as HTMLElement,
      onSetRefCallback,
      onLoadedCallback
    }
  }

  it('removes listeners from the original webview element on unmount', () => {
    const { unmount, webview: boundWebview } = renderContainer()

    unmount()

    expect(boundWebview.addEventListener).toHaveBeenCalledWith('did-start-loading', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-start-loading', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('dom-ready', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('ready-to-show', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function))
  })

  it('cancels delayed loaded callbacks when unmounted before the delay finishes', () => {
    vi.useFakeTimers()
    const onLoadedCallback = vi.fn()

    try {
      const { unmount, webview } = renderContainer(onLoadedCallback)

      act(() => {
        webview.dispatchEvent(new Event('did-finish-load'))
      })

      unmount()

      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(onLoadedCallback).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels stale loaded callbacks when a new load starts before the delay finishes', () => {
    vi.useFakeTimers()
    const onLoadedCallback = vi.fn()

    try {
      const { webview } = renderContainer(onLoadedCallback)

      act(() => {
        webview.dispatchEvent(new Event('did-finish-load'))
        webview.dispatchEvent(new Event('did-start-loading'))
        vi.advanceTimersByTime(100)
      })

      expect(onLoadedCallback).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
