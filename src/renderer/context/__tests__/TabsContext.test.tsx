// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheState, languageState, setPinnedTabsRaw, translate } = vi.hoisted(() => {
  const translations: Record<string, Record<string, string>> = {
    'en-US': {
      'title.home': 'Home',
      'title.paintings': 'Paintings'
    },
    'zh-CN': {
      'title.home': '首页',
      'title.paintings': '绘画'
    }
  }
  const cacheState = {
    pinnedTabs: [] as unknown[]
  }
  const setPinnedTabsRaw = vi.fn((next: unknown[] | ((prev: unknown[]) => unknown[])) => {
    cacheState.pinnedTabs = typeof next === 'function' ? next(cacheState.pinnedTabs) : next
  })

  return {
    cacheState,
    languageState: { language: 'en-US' },
    setPinnedTabsRaw,
    translate: (key: string) => translations[languageState.language]?.[key] ?? key
  }
})

vi.mock('@renderer/i18n', () => ({
  default: {
    t: translate
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      language: languageState.language
    }
  })
}))

vi.mock('@renderer/data/hooks/useCache', () => {
  // Return stable references across renders. With a fresh array every render the
  // `tabs` useMemo would recompute unconditionally, masking whether
  // `i18n.language` is actually wired into its dependency array — so the
  // language-flip assertion below would pass even if the dep were dropped.
  return {
    usePersistCache: () => [cacheState.pinnedTabs, setPinnedTabsRaw]
  }
})

import { RESOURCE_SELECTOR_FORCE_CLOSE_EVENT } from '../../components/ResourceSelector/resourceSelectorEvents'
import { TabsProvider, useTabsContext } from '../TabsContext'

function TabsProbe() {
  const { activeTabId, closeTab, openTab, pinTab, setTabs, tabs } = useTabsContext()
  const homeTab = tabs.find((tab) => tab.id === 'home')
  const paintingsTab = tabs.find((tab) => tab.id === 'paintings-tab')
  const customTab = tabs.find((tab) => tab.id === 'mini-app-tab')
  const rawAgentTab = tabs.find((tab) => tab.id === 'raw-agent-tab')

  return (
    <>
      <div data-testid="active-tab-id">{activeTabId}</div>
      <div data-testid="tab-count">{tabs.length}</div>
      <div data-testid="home-tab-title">{homeTab?.title}</div>
      <div data-testid="paintings-tab-title">{paintingsTab?.title}</div>
      <div data-testid="custom-tab-title">{customTab?.title}</div>
      <div data-testid="raw-agent-tab-url">{rawAgentTab?.url}</div>
      <button
        type="button"
        onClick={() =>
          openTab('/app/paintings/zhipu', {
            id: 'paintings-tab',
            forceNew: true
          })
        }>
        Open paintings tab
      </button>
      <button
        type="button"
        onClick={() =>
          openTab('/app/mini-app/weather', {
            id: 'mini-app-tab',
            title: 'Weather App',
            forceNew: true
          })
        }>
        Open custom tab
      </button>
      <button type="button" onClick={() => closeTab('paintings-tab')}>
        Close paintings tab
      </button>
      <button
        type="button"
        onClick={() =>
          setTabs([
            {
              id: 'home',
              type: 'route',
              url: '/home',
              title: 'Home',
              lastAccessTime: 1,
              isDormant: false
            },
            {
              id: 'raw-agent-tab',
              type: 'route',
              url: '/agents/raw-agent',
              title: 'Raw agent',
              lastAccessTime: 2,
              isDormant: false
            }
          ])
        }>
        Set raw tabs with home
      </button>
      <button type="button" onClick={() => openTab('/agents', { id: 'legacy-agent-tab' })}>
        Open legacy agents tab
      </button>
      <button
        type="button"
        onClick={() =>
          setTabs([{ id: 'home', type: 'route', url: '/home', title: 'Home', lastAccessTime: 1, isDormant: false }])
        }>
        Reset to home only
      </button>
      <button type="button" onClick={() => pinTab('home')}>
        Pin home tab
      </button>
    </>
  )
}

describe('TabsContext language refresh', () => {
  beforeEach(() => {
    languageState.language = 'en-US'
    cacheState.pinnedTabs = []
    setPinnedTabsRaw.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('refreshes localized route tab titles when the app language changes without replacing custom titles', () => {
    const { rerender } = render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('Home')

    fireEvent.click(screen.getByRole('button', { name: 'Open paintings tab' }))
    expect(screen.getByTestId('paintings-tab-title')).toHaveTextContent('Paintings')

    fireEvent.click(screen.getByRole('button', { name: 'Open custom tab' }))
    expect(screen.getByTestId('custom-tab-title')).toHaveTextContent('Weather App')

    languageState.language = 'zh-CN'
    rerender(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('首页')
    expect(screen.getByTestId('paintings-tab-title')).toHaveTextContent('绘画')
    expect(screen.getByTestId('custom-tab-title')).toHaveTextContent('Weather App')
  })

  it('allows closing the only business tab when the home tab remains', () => {
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open paintings tab' }))

    expect(screen.getByTestId('tab-count')).toHaveTextContent('2')
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('paintings-tab')

    fireEvent.click(screen.getByRole('button', { name: 'Close paintings tab' }))

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1')
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home')
    expect(screen.getByTestId('paintings-tab-title')).toBeEmptyDOMElement()
  })

  it('does not duplicate the implicit home tab when replacing tabs', () => {
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set raw tabs with home' }))

    expect(screen.getByTestId('tab-count')).toHaveTextContent('2')
    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('Home')
  })

  it('normalizes legacy agent tab routes to the current app route', () => {
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set raw tabs with home' }))
    expect(screen.getByTestId('raw-agent-tab-url')).toHaveTextContent('/app/agents')

    fireEvent.click(screen.getByRole('button', { name: 'Open legacy agents tab' }))
    expect(screen.getByTestId('tab-count')).toHaveTextContent('2')
  })

  it('closes transient selectors before opening a new tab', () => {
    const closeSelectors = vi.fn()
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeSelectors)

    try {
      render(
        <TabsProvider>
          <TabsProbe />
        </TabsProvider>
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open paintings tab' }))

      expect(closeSelectors).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('active-tab-id')).toHaveTextContent('paintings-tab')
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, closeSelectors)
    }
  })

  it('falls back to the home tab when replacing tabs removes the active tab', () => {
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open paintings tab' }))
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('paintings-tab')

    fireEvent.click(screen.getByRole('button', { name: 'Reset to home only' }))

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1')
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home')
  })

  it('sanitizes legacy persisted pinned home tabs', async () => {
    cacheState.pinnedTabs = [
      {
        id: 'home',
        type: 'route',
        url: '/home',
        title: 'Pinned Home',
        lastAccessTime: 1,
        isDormant: false,
        isPinned: true
      }
    ]

    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1')
    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('Home')

    await waitFor(() => {
      expect(setPinnedTabsRaw).toHaveBeenCalledWith([])
    })
  })

  it('ignores corrupted persisted pinned tabs instead of failing the tab shell render', () => {
    cacheState.pinnedTabs = {
      id: 'bad-cache-shape',
      type: 'route',
      url: '/app/paintings'
    } as unknown as unknown[]

    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1')
    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('Home')

    cacheState.pinnedTabs = [
      { id: '', type: 'route', url: '/app/paintings' },
      { id: 'missing-url', type: 'route' },
      {
        id: 'valid-pinned',
        type: 'route',
        url: '/app/paintings',
        title: 'Paintings',
        lastAccessTime: 1,
        isDormant: false,
        isPinned: true
      }
    ] as unknown[]

    cleanup()
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-count')).toHaveTextContent('2')
  })

  it('does not allow the implicit home tab to be pinned', () => {
    render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin home tab' }))

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1')
    expect(setPinnedTabsRaw).not.toHaveBeenCalled()
  })
})
