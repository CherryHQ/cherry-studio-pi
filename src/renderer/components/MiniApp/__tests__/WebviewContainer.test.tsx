import { render } from '@testing-library/react'
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
  it('removes listeners from the original webview element on unmount', () => {
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

    const { unmount } = render(
      <WebviewContainer
        appid="mini-app"
        url="https://example.com"
        onSetRefCallback={onSetRefCallback as never}
        onLoadedCallback={vi.fn()}
        onNavigateCallback={vi.fn()}
      />
    )

    expect(webview).not.toBeNull()
    const boundWebview = webview as unknown as HTMLElement

    unmount()

    expect(boundWebview.addEventListener).toHaveBeenCalledWith('did-start-loading', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-start-loading', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('dom-ready', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('ready-to-show', expect.any(Function))
    expect(boundWebview.removeEventListener).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function))
  })
})
