// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { Tab } from '@renderer/hooks/useTabs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <div role="menuitem" onClick={onSelect}>
      {children}
    </div>
  ),
  ContextMenuItemContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false
}))

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: () => null
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) => url
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../ShellTabBarActions', () => ({
  ShellTabBarActions: () => null,
  useShellTabBarLayout: () => ({ rightPaddingClass: '' })
}))

vi.mock('../useTabDrag', () => ({
  useTabDrag: () => ({
    tabBarRef: { current: null },
    tabRefs: { current: new Map() },
    noTransition: false,
    getTranslateX: () => 0,
    handlePointerDown: vi.fn(),
    handleTabClick: vi.fn(),
    isDragging: () => false,
    isGhost: () => false
  })
}))

import { AppShellTabBar } from '../AppShellTabBar'

const tabs: Tab[] = [
  {
    id: 'home',
    type: 'route',
    url: '/home',
    title: 'Home',
    lastAccessTime: 1,
    isDormant: false
  },
  {
    id: 'agent-tab',
    type: 'route',
    url: '/agents/agent-1',
    title: 'Agent',
    lastAccessTime: 2,
    isDormant: false
  }
]

describe('AppShellTabBar', () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe = vi.fn()
      disconnect = vi.fn()
    }

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock
    })
  })

  it('shows a close button for the only business tab when the home tab remains', async () => {
    const user = userEvent.setup()
    const closeTab = vi.fn()

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="agent-tab"
        setActiveTab={vi.fn()}
        closeTab={closeTab}
        addTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'tab.close' }))

    expect(closeTab).toHaveBeenCalledWith('agent-tab')
  })
})
