import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useAgentSessionRouteSeed } from '@renderer/hooks/agents/useAgentSessionRouteSeed'
import { useCommandHandler } from '@renderer/hooks/command'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSaveFailedToast } from '@renderer/hooks/useSaveFailedToast'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'
import AgentSidePanelDrawer from './components/AgentSidePanelDrawer'
import { AgentEmpty } from './components/status'

const logger = loggerService.withContext('AgentPage')

const AgentPage = () => {
  const { isLeftNavbar } = useNavbarPosition()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const showSaveFailed = useSaveFailedToast()
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar).catch(showSaveFailed)
  const { topicPosition } = useSettings()
  const { agents } = useAgents()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>
  const seededSessionId = useAgentSessionRouteSeed(routeSearch.sessionId)

  // Seed `agent.active_session_id` to the most-recent session when nothing is set.
  useAgentSessionInitializer({ disabled: Boolean(seededSessionId) })

  useEffect(() => {
    if (!seededSessionId) return

    void navigate({ to: '/app/agents', search: {}, replace: true })
  }, [navigate, seededSessionId])

  useCommandHandler('app.sidebar.toggle', () => {
    if (topicPosition === 'left') {
      toggleShowSidebar()
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useCommandHandler('topic.sidebar.toggle', () => {
    if (topicPosition === 'right') {
      toggleShowSidebar()
    } else {
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useEffect(() => {
    void window.api.window
      .setMinimumSize(showSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
      .catch((error) => {
        logger.warn('Failed to set agent window minimum size', error as Error)
      })
    return () => {
      void window.api.window.resetMinimumSize().catch((error) => {
        logger.warn('Failed to reset agent window minimum size', error as Error)
      })
    }
  }, [showSidebar])

  useEffect(() => {
    if (showSidebar) {
      AgentSidePanelDrawer.hide()
    }
  }, [showSidebar])

  useEffect(() => {
    return () => {
      AgentSidePanelDrawer.hide()
    }
  }, [])

  if (agents && agents.length === 0) {
    return (
      <Container>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>{t('common.agent_one')}</NavbarCenter>
        </Navbar>
        <AgentEmpty />
      </Container>
    )
  }

  return (
    <Container>
      <AgentNavbar />
      <div
        id={isLeftNavbar ? 'content-container' : undefined}
        className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AnimatePresence initial={false}>
          {showSidebar && (
            <ErrorBoundary>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}>
                <AgentSidePanel />
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>
          <AgentChat />
        </ErrorBoundary>
      </div>
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div id="agent-page" className={cn('flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
