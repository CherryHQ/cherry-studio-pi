import { Button } from '@cherrystudio/ui'
import { requestCloseResourceSelectors } from '@renderer/components/ResourceSelector/resourceSelectorEvents'
import { useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useAgentWorkspaceMutations } from '@renderer/hooks/agents/useWorkspace'
import { cn } from '@renderer/utils'
import { getErrorMessage } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type WorkspaceSelectorProps = {
  session: AgentSessionEntity
}

const WorkspaceSelector = ({ session }: WorkspaceSelectorProps) => {
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState(false)
  const { createWorkspaceByPath } = useAgentWorkspaceMutations()
  const { updateSession } = useUpdateSession(session.agentId)

  const workspacePath = session.workspace?.path

  const workspaceLabel = session.workspace
    ? session.workspace.name || session.workspace.path
    : t('selector.workspace.placeholder')
  const actionLabel = session.workspace ? t('agent.session.workspace.change') : t('agent.session.workspace.select')

  const handleSelectWorkspace = async () => {
    if (selecting) return
    requestCloseResourceSelectors()
    setSelecting(true)
    try {
      const selectedPath = await window.api.file.selectFolder({
        title: actionLabel,
        properties: ['openDirectory', 'createDirectory']
      })
      if (!selectedPath) return

      const workspace = await createWorkspaceByPath(selectedPath)
      if (!workspace) return

      const updated = await updateSession(
        {
          id: session.id,
          workspaceId: workspace.id
        },
        { showSuccessToast: false }
      )
      if (!updated) return
      window.toast.success(t('agent.session.workspace.updated'))
    } catch (error) {
      window.toast.error({
        title: t('agent.session.workspace.select_failed'),
        description: getErrorMessage(error)
      })
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="ml-2 max-w-60 shrink-0 [-webkit-app-region:no-drag]" title={workspacePath ?? undefined}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={selecting}
        loading={selecting}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void handleSelectWorkspace()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={`${actionLabel}: ${workspaceLabel}`}
        className={cn(
          'flex h-7 w-auto max-w-60 items-center gap-1.5 rounded-full px-2 text-xs shadow-none [-webkit-app-region:no-drag]',
          'text-foreground-500 dark:text-foreground-400'
        )}>
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{workspaceLabel}</span>
      </Button>
    </div>
  )
}

export default WorkspaceSelector
