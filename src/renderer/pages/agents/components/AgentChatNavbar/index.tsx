import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { cn } from '@renderer/utils'
import type { AgentEntity } from '@shared/data/types/agent'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity
  className?: string
}

const AgentChatNavbar = ({ activeAgent, className }: Props) => {
  useCommandHandler('app.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar h-(--navbar-height) [-webkit-app-region:no-drag]', className)}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-hidden [-webkit-app-region:no-drag]">
        <AgentContent activeAgent={activeAgent} />
      </div>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
