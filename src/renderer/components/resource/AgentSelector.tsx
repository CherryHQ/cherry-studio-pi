import { loggerService } from '@logger'
import type { SelectorShellMountStrategy, SelectorShellProps } from '@renderer/components/Selector/shell/SelectorShell'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { usePins } from '@renderer/hooks/usePins'
import type { AgentDetail } from '@renderer/pages/library/types'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { lazy, type ReactElement, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceSelectorShell, type ResourceSelectorShellItem } from './ResourceSelectorShell'

const logger = loggerService.withContext('AgentSelector')
const AgentEditDialog = lazy(() =>
  import('@renderer/components/resource/dialogs/edit/AgentEditDialog').then((module) => ({
    default: module.AgentEditDialog
  }))
)
const AgentCreateWizardDialog = lazy(() =>
  import('@renderer/components/resource/dialogs/edit/AgentEditDialog').then((module) => ({
    default: module.AgentCreateWizardDialog
  }))
)

function waitForDialogCloseFrame() {
  if (typeof window === 'undefined') return Promise.resolve()

  return new Promise<void>((resolve) => {
    let resolved = false
    const resolveOnce = () => {
      if (resolved) return
      resolved = true
      resolve()
    }

    const timeoutId = window.setTimeout(resolveOnce, 50)
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          window.clearTimeout(timeoutId)
          resolveOnce()
        })
      )
    }
  })
}

export type AgentSelectorItem = ResourceSelectorShellItem

type SharedProps = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  autoSelectOnCreate?: boolean
  side?: SelectorShellProps['side']
  align?: SelectorShellProps['align']
  sideOffset?: SelectorShellProps['sideOffset']
  mountStrategy?: SelectorShellMountStrategy
}

export type AgentSelectorSingleIdProps = SharedProps & {
  selectionType?: 'id'
  value: string | null
  onChange: (value: string | null) => void
}

export type AgentSelectorSingleItemProps = SharedProps & {
  selectionType: 'item'
  value: AgentSelectorItem | null
  onChange: (value: AgentSelectorItem | null) => void
}

export type AgentSelectorProps = AgentSelectorSingleIdProps | AgentSelectorSingleItemProps

export function AgentSelector(props: AgentSelectorProps) {
  const { trigger, open, onOpenChange, autoSelectOnCreate, side, align, sideOffset, mountStrategy } = props
  const { t } = useTranslation()
  const standardModelFilter = useAgentModelFilter('pi')
  const enhancedModelFilter = useAgentModelFilter('claude-code')
  const [internalOpen, setInternalOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentDetail | null>(null)
  const selectorOpen = open ?? internalOpen
  const handleSelectorOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, open]
  )

  const { data, isLoading, refetch } = useQuery('/agents', { query: { limit: 500 } })
  const {
    isLoading: isPinnedLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds,
    refetch: refetchPins,
    togglePin
  } = usePins('agent')
  const isPinActionDisabled = isPinnedLoading || isPinsRefreshing || isPinsMutating
  const createModelFilters = useMemo(
    () => ({ pi: standardModelFilter, 'claude-code': enhancedModelFilter }),
    [enhancedModelFilter, standardModelFilter]
  )
  const editModelFilter = editingAgent?.type === 'claude-code' ? enhancedModelFilter : standardModelFilter

  const items: AgentSelectorItem[] = useMemo(
    () =>
      (data?.items ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        emoji: getAgentAvatarFromConfiguration(agent.configuration)
      })),
    [data]
  )

  const handleTogglePin = useCallback(
    async (id: string) => {
      if (isPinActionDisabled) return
      try {
        await togglePin(id)
      } catch (error) {
        logger.error('Failed to toggle agent pin', error as Error, { id })
        window.toast?.error(t('common.error'))
      }
    },
    [isPinActionDisabled, togglePin, t]
  )

  const handleEditItem = useCallback(
    (item: AgentSelectorItem) => {
      const agent = data?.items.find((candidate) => candidate.id === item.id)
      if (!agent) return

      setEditingAgent(agent)
      setEditDialogOpen(true)
    },
    [data?.items]
  )

  const handleEditDialogOpenChange = useCallback((nextOpen: boolean) => {
    setEditDialogOpen(nextOpen)
    if (!nextOpen) {
      setEditingAgent(null)
    }
  }, [])

  const handleCreated = useCallback(
    async (created: AgentDetail) => {
      setCreateDialogOpen(false)
      try {
        await refetch()
      } catch (error) {
        logger.warn('Failed to refresh agents after selector create', { error })
        window.toast?.error(t('selector.create_dialog.refresh_failed'))
      }
      if (autoSelectOnCreate) {
        if (props.selectionType === 'item') {
          props.onChange({
            id: created.id,
            name: created.name,
            description: created.description,
            emoji: getAgentAvatarFromConfiguration(created.configuration)
          })
        } else {
          props.onChange(created.id)
        }
        handleSelectorOpenChange(false)
        return
      }
      await waitForDialogCloseFrame()
      handleSelectorOpenChange(true)
    },
    [autoSelectOnCreate, handleSelectorOpenChange, props, refetch, t]
  )

  const handleEditSaved = useCallback(async () => {
    setEditDialogOpen(false)
    setEditingAgent(null)
    try {
      await refetch()
    } catch (error) {
      logger.warn('Failed to refresh agents after selector edit', { error })
      window.toast?.error(t('selector.edit_dialog.refresh_failed'))
    }
  }, [refetch, t])

  const createDialog = (
    <Suspense fallback={null}>
      <AgentCreateWizardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreated}
        agentModelFilters={createModelFilters}
      />
    </Suspense>
  )

  const editDialog =
    editDialogOpen || editingAgent ? (
      <Suspense fallback={null}>
        <AgentEditDialog
          open={editDialogOpen}
          resource={editingAgent}
          onOpenChange={handleEditDialogOpenChange}
          onSaved={handleEditSaved}
          modelFilter={editModelFilter}
        />
      </Suspense>
    ) : null

  const shared = {
    trigger,
    open: selectorOpen,
    onOpenChange: handleSelectorOpenChange,
    side,
    align,
    sideOffset,
    mountStrategy,
    onOpen: refetchPins,
    items,
    pinnedIds,
    emptyState: { preset: 'no-agent' as const },
    onTogglePin: handleTogglePin,
    isPinActionDisabled,
    onEditItem: handleEditItem,
    onCreateNew: () => {
      handleSelectorOpenChange(false)
      setCreateDialogOpen(true)
    },
    loading: isLoading || isPinnedLoading,
    labels: {
      searchPlaceholder: t('selector.agent.search_placeholder'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      edit: t('agent.edit.title'),
      createNew: t('selector.agent.create_new'),
      emptyText: t('selector.agent.empty_text'),
      pinnedTitle: t('selector.common.pinned_title')
    }
  }

  if (props.selectionType === 'item') {
    return (
      <>
        <ResourceSelectorShell {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
        {createDialog}
        {editDialog}
      </>
    )
  }

  return (
    <>
      <ResourceSelectorShell {...shared} value={props.value} onChange={props.onChange} />
      {createDialog}
      {editDialog}
    </>
  )
}
