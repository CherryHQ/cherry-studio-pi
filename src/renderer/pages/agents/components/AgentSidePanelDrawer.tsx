import { useTopViewClose } from '@renderer/components/Popups/useTopViewClose'
import {
  closeTransientResourceSelectors,
  RESOURCE_SELECTOR_FORCE_CLOSE_EVENT
} from '@renderer/components/ResourceSelector/resourceSelectorEvents'
import { TopView } from '@renderer/components/TopView'
import { isMac } from '@renderer/config/constant'
import { Drawer } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import AgentSidePanel from '../AgentSidePanel'

interface Props {
  resolve: () => void
}

const PopupContainer = ({ resolve }: Props) => {
  const [open, setOpen] = useState(true)
  const close = useTopViewClose<void>({
    resolve,
    setOpen,
    topViewKey: TopViewKey,
    afterClose: AgentSidePanelDrawer.clearActive
  })

  const onClose = useCallback(() => {
    close()
  }, [close])

  useEffect(() => {
    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, onClose)
    return () => {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, onClose)
    }
  }, [onClose])

  return (
    <Drawer
      title={null}
      height="100vh"
      placement="left"
      open={open}
      onClose={onClose}
      style={{ width: 'var(--assistants-width)' }}
      styles={{
        header: { display: 'none' },
        body: {
          display: 'flex',
          padding: 0,
          paddingTop: isMac ? 'var(--navbar-height)' : 0,
          height: 'calc(100vh - var(--navbar-height))',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background)'
        },
        wrapper: {
          width: 'var(--assistants-width)'
        }
      }}>
      <AgentSidePanel onSelectItem={onClose} />
    </Drawer>
  )
}

const TopViewKey = 'AgentSidePanelDrawer'

export default class AgentSidePanelDrawer {
  static topviewId = 0
  private static activePromise: Promise<void> | null = null
  private static activeResolve: (() => void) | null = null

  static clearActive = () => {
    AgentSidePanelDrawer.activePromise = null
    AgentSidePanelDrawer.activeResolve = null
  }

  static hide() {
    closeTransientResourceSelectors()
    // Programmatic closes usually happen right before a route change or modal opens.
    // Remove the TopView immediately so the drawer cannot linger above the next surface.
    TopView.hide(TopViewKey)
    AgentSidePanelDrawer.activeResolve?.()
    AgentSidePanelDrawer.clearActive()
  }

  static show() {
    closeTransientResourceSelectors()
    if (AgentSidePanelDrawer.activePromise) {
      return AgentSidePanelDrawer.activePromise
    }

    AgentSidePanelDrawer.activePromise = new Promise<void>((resolve) => {
      AgentSidePanelDrawer.activeResolve = resolve
      TopView.show(
        <PopupContainer
          resolve={() => {
            resolve()
          }}
        />,
        TopViewKey
      )
    })

    return AgentSidePanelDrawer.activePromise
  }
}
