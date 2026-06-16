import { useTopViewClose } from '@renderer/components/Popups/useTopViewClose'
import { TopView } from '@renderer/components/TopView'
import { isMac } from '@renderer/config/constant'
import { Drawer } from 'antd'
import { useState } from 'react'

import AgentSidePanel from '../AgentSidePanel'

interface Props {
  resolve: () => void
}

const PopupContainer = ({ resolve }: Props) => {
  const [open, setOpen] = useState(true)
  const close = useTopViewClose<void>({ resolve, setOpen, topViewKey: TopViewKey })

  const onClose = () => {
    close()
  }

  AgentSidePanelDrawer.hide = onClose

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
          backgroundColor: 'var(--color-background-opacity)'
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
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<void>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, TopViewKey)
    })
  }
}
