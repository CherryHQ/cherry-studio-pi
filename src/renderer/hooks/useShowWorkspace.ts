import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCallback } from 'react'

import { useSaveFailedToast } from './useSaveFailedToast'

const logger = loggerService.withContext('useShowWorkspace')

export function useShowWorkspace() {
  const [showWorkspace, setShowWorkspace] = usePreference('feature.notes.show_workspace')
  const showSaveFailed = useSaveFailedToast('notes.settings.save_failed')

  const updateShowWorkspace = useCallback(
    (show: boolean) => {
      void setShowWorkspace(show).catch((error) => {
        logger.error('Failed to update notes workspace visibility', error as Error)
        showSaveFailed(error)
      })
    },
    [setShowWorkspace, showSaveFailed]
  )
  const toggleShowWorkspace = useCallback(() => {
    updateShowWorkspace(!showWorkspace)
  }, [showWorkspace, updateShowWorkspace])

  return {
    showWorkspace,
    setShowWorkspace: updateShowWorkspace,
    toggleShowWorkspace
  }
}
