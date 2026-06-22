import type { MiniApp } from '@shared/data/types/miniApp'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppPage from '../MiniAppPage'

const stubApp = (id: string): MiniApp => ({
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  logo: `${id}-logo`,
  presetMiniAppId: id as MiniApp['presetMiniAppId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  appId: 'alpha',
  allApps: [] as MiniApp[],
  error: null as unknown,
  loggerError: vi.fn(),
  openedKeepAliveMiniApps: [] as MiniApp[],
  loaded: new Map<string, boolean>(),
  openMiniAppKeepAlive: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError,
      debug: vi.fn()
    })
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ appId: mocks.appId })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({
    openMiniAppKeepAlive: mocks.openMiniAppKeepAlive
  })
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: mocks.allApps,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    isLoading: false,
    error: mocks.error
  })
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: (appId: string) => mocks.loaded.get(appId) ?? false,
  onWebviewStateChange: vi.fn(() => vi.fn()),
  setWebviewLoaded: vi.fn((appId: string, loaded: boolean) => {
    mocks.loaded.set(appId, loaded)
  })
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: ({ logo }: { logo: string }) => <div data-testid="logo-avatar">{logo}</div>
}))

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: (logo: string) => logo
}))

vi.mock('../components/MinimalToolbar', () => ({
  default: ({ app, currentUrl }: { app: MiniApp; currentUrl: string | null }) => (
    <div data-testid="minimal-toolbar">
      {app.appId}:{currentUrl}
    </div>
  )
}))

vi.mock('../components/WebviewSearch', () => ({
  default: ({ appId, isWebviewReady }: { appId: string; isWebviewReady: boolean }) => (
    <div data-testid="webview-search">
      {appId}:{String(isWebviewReady)}
    </div>
  )
}))

vi.mock('react-spinners/BeatLoader', () => ({
  default: () => <div data-testid="beat-loader" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MiniAppPage', () => {
  beforeEach(() => {
    mocks.appId = 'alpha'
    mocks.allApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.error = null
    mocks.openedKeepAliveMiniApps = []
    mocks.loaded = new Map<string, boolean>()
    mocks.loggerError.mockClear()
    mocks.openMiniAppKeepAlive.mockClear()
    ;(globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
      escape: (value: string) => value
    }
  })

  it('resets loaded state and toolbar URL when the route switches mini apps', async () => {
    mocks.loaded.set('alpha', true)
    mocks.loaded.set('bravo', false)

    const { rerender } = render(<MiniAppPage />)

    expect(screen.getByTestId('webview-search')).toHaveTextContent('alpha:true')
    expect(screen.getByTestId('minimal-toolbar')).toHaveTextContent('alpha:https://alpha.example.com')

    mocks.appId = 'bravo'
    rerender(<MiniAppPage />)

    await waitFor(() => {
      expect(screen.getByTestId('webview-search')).toHaveTextContent('bravo:false')
      expect(screen.getByTestId('minimal-toolbar')).toHaveTextContent('bravo:https://bravo.example.com')
    })
  })

  it('preserves nested mini-app load error details in logs', async () => {
    mocks.error = { error: { message: 'mini app store unavailable' } }

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to load mini apps',
        expect.objectContaining({ message: 'mini app store unavailable' })
      )
    })
    expect(mocks.openMiniAppKeepAlive).not.toHaveBeenCalled()
  })
})
