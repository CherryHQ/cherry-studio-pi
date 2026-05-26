import '@renderer/databases'

import { RoutePaneActiveProvider } from '@renderer/context/RoutePaneContext'
import { useAppSelector } from '@renderer/store'
import { markRouteSwitchPainted } from '@renderer/utils/routePerformance'
import { getTabBaseId, getTabIdFromPath } from '@renderer/utils/tabs'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { Location } from 'react-router-dom'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import TabsContainer from './components/Tab/TabContainer'
import NavigationHandler from './handler/NavigationHandler'
import { useOnboardingState } from './hooks/useOnboardingState'
import { useNavbarPosition } from './hooks/useSettings'
import AgentPage from './pages/agents/AgentPage'
import AgentToolInstallPage from './pages/agentTools/AgentToolInstallPage'
import CodeToolsPage from './pages/code/CodeToolsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import LaunchpadPage from './pages/launchpad/LaunchpadPage'
import MinAppPage from './pages/minapps/MinAppPage'
import MinAppsPage from './pages/minapps/MinAppsPage'
import NotesPage from './pages/notes/NotesPage'
import { OnboardingPage } from './pages/onboarding'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import AssistantPresetsPage from './pages/store/assistants/presets/AssistantPresetsPage'
import TranslatePage from './pages/translate/TranslatePage'

type KeepAliveRouteEntry = {
  id: string
  baseId: string
  location: Location
  path: string
  lastUsedAt: number
}

const KEEP_ALIVE_ROUTE_LIMIT = 6
const KEEP_ALIVE_ROUTE_IDS = new Set(['home', 'agents', 'settings', 'knowledge', 'files', 'notes'])

const getLocationPath = (location: Location) => `${location.pathname}${location.search}`
const isKeepAliveRoute = (baseId: string) => KEEP_ALIVE_ROUTE_IDS.has(baseId)

const AppRoutes: FC<{ location?: Location }> = ({ location }) => {
  return (
    <Routes location={location}>
      <Route path="/" element={<HomePage />} />
      <Route path="/agents" element={<AgentPage />} />
      <Route path="/store" element={<AssistantPresetsPage />} />
      <Route path="/paintings/*" element={<PaintingsRoutePage />} />
      <Route path="/translate" element={<TranslatePage />} />
      <Route path="/files" element={<FilesPage />} />
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route path="/apps/:appId" element={<MinAppPage />} />
      <Route path="/apps" element={<MinAppsPage />} />
      <Route path="/code" element={<CodeToolsPage />} />
      <Route path="/openclaw" element={<AgentToolInstallPage tool="openclaw" />} />
      <Route path="/hermes" element={<AgentToolInstallPage tool="hermes" />} />
      <Route path="/settings/*" element={<SettingsPage />} />
      <Route path="/launchpad" element={<LaunchpadPage />} />
    </Routes>
  )
}

const RoutePane: FC<{ active: boolean; entry?: KeepAliveRouteEntry }> = ({ active, entry }) => {
  useEffect(() => {
    if (!active || !entry) return

    const frame = requestAnimationFrame(() => {
      markRouteSwitchPainted(entry.baseId, entry.path)
    })

    return () => cancelAnimationFrame(frame)
  }, [active, entry])

  return (
    <RoutePaneContainer $active={active} aria-hidden={!active}>
      <RoutePaneActiveProvider active={active}>
        <ErrorBoundary>
          <AppRoutes location={entry?.location} />
        </ErrorBoundary>
      </RoutePaneActiveProvider>
    </RoutePaneContainer>
  )
}

const KeepAliveRoutes: FC = () => {
  const location = useLocation()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const [entries, setEntries] = useState<KeepAliveRouteEntry[]>([])
  const path = getLocationPath(location)
  const activeTabId = getTabIdFromPath(path)
  const activeBaseId = getTabBaseId(activeTabId)
  const activeCacheable = isKeepAliveRoute(activeBaseId)
  const tabIdsKey = useMemo(() => tabs.map((tab) => tab.id).join('|'), [tabs])
  const openTabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs])

  useEffect(() => {
    setEntries((previousEntries) => {
      const retainedEntries = previousEntries.filter((entry) => openTabIds.has(entry.id))

      if (!activeCacheable) {
        return retainedEntries
      }

      const nextEntry: KeepAliveRouteEntry = {
        id: activeTabId,
        baseId: activeBaseId,
        location,
        path,
        lastUsedAt: performance.now()
      }
      const nextEntries = retainedEntries.filter((entry) => entry.id !== activeTabId)
      nextEntries.push(nextEntry)

      if (nextEntries.length <= KEEP_ALIVE_ROUTE_LIMIT) {
        return nextEntries
      }

      const removableEntries = nextEntries.filter((entry) => entry.id !== activeTabId)
      const oldestEntry = removableEntries.reduce((oldest, entry) =>
        entry.lastUsedAt < oldest.lastUsedAt ? entry : oldest
      )

      return nextEntries.filter((entry) => entry.id !== oldestEntry.id)
    })
  }, [activeBaseId, activeCacheable, activeTabId, location, openTabIds, path, tabIdsKey])

  useEffect(() => {
    if (activeCacheable) return

    const frame = requestAnimationFrame(() => {
      markRouteSwitchPainted(activeBaseId, path)
    })

    return () => cancelAnimationFrame(frame)
  }, [activeBaseId, activeCacheable, path])

  const routeEntries = useMemo(() => {
    if (!activeCacheable) {
      return entries
    }

    const activeEntry: KeepAliveRouteEntry = {
      id: activeTabId,
      baseId: activeBaseId,
      location,
      path,
      lastUsedAt: performance.now()
    }
    const inactiveEntries = entries
      .filter((entry) => entry.id !== activeTabId)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)

    return [activeEntry, ...inactiveEntries]
  }, [activeBaseId, activeCacheable, activeTabId, entries, location, path])

  return (
    <RoutesStack>
      {!activeCacheable && <RoutePane active />}
      {routeEntries.map((entry) => (
        <RoutePane key={entry.id} active={entry.id === activeTabId} entry={entry} />
      ))}
    </RoutesStack>
  )
}

const Router: FC = () => {
  const { onboardingCompleted, completeOnboarding } = useOnboardingState()
  const { navbarPosition } = useNavbarPosition()

  const routes = useMemo(() => <KeepAliveRoutes />, [])

  if (!onboardingCompleted) {
    return <OnboardingPage onComplete={completeOnboarding} />
  }

  if (navbarPosition === 'left') {
    return (
      <HashRouter>
        <Sidebar />
        <TabsContainer withSidebar>{routes}</TabsContainer>
        <NavigationHandler />
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      <NavigationHandler />
      <TabsContainer>{routes}</TabsContainer>
    </HashRouter>
  )
}

const RoutesStack = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
`

const RoutePaneContainer = styled.div<{ $active: boolean }>`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  opacity: ${(props) => (props.$active ? 1 : 0)};
  pointer-events: ${(props) => (props.$active ? 'auto' : 'none')};
  visibility: ${(props) => (props.$active ? 'visible' : 'hidden')};

  ${(props) =>
    props.$active
      ? `
        position: relative;
        z-index: 1;
      `
      : `
        position: absolute;
        inset: 0;
        z-index: 0;
        contain: layout paint style;
      `}
`

export default Router
