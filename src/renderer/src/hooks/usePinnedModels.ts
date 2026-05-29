import { loggerService } from '@logger'
import { getModelUniqId } from '@renderer/services/ModelService'
import { storageV2DexieSettingsMirrorService } from '@renderer/services/StorageV2DexieSettingsMirrorService'
import { storageV2DexieSettingsRecoveryService } from '@renderer/services/StorageV2DexieSettingsRecoveryService'
import { sortBy } from 'lodash'
import { useCallback, useEffect, useState } from 'react'

import { useProviders } from './useProvider'

const logger = loggerService.withContext('usePinnedModels')
const PINNED_MODELS_SETTING_ID = 'pinned:models'

export const usePinnedModels = () => {
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const { providers } = useProviders()

  useEffect(() => {
    const loadPinnedModels = async () => {
      setLoading(true)
      const setting = await storageV2DexieSettingsRecoveryService.getSetting<string[]>(
        'pinned:models',
        'pinned-models-empty'
      )
      const savedPinnedModels = setting?.value || []

      // Filter out invalid pinned models
      const allModelIds = providers.flatMap((p) => p.models || []).map((m) => getModelUniqId(m))
      const validPinnedModels = savedPinnedModels.filter((id) => allModelIds.includes(id))

      // Update storage if there were invalid models
      if (validPinnedModels.length !== savedPinnedModels.length) {
        await storageV2DexieSettingsMirrorService.putSettingAndFlush({
          id: PINNED_MODELS_SETTING_ID,
          value: validPinnedModels
        })
      }

      setPinnedModels(sortBy(validPinnedModels))
      setLoading(false)
    }

    loadPinnedModels().catch((error) => {
      logger.error('Failed to load pinned models', error)
      setPinnedModels([])
      setLoading(false)
    })
  }, [providers])

  const updatePinnedModels = useCallback(async (models: string[]) => {
    await storageV2DexieSettingsMirrorService.putSettingAndFlush({ id: PINNED_MODELS_SETTING_ID, value: models })
    setPinnedModels(sortBy(models))
  }, [])

  /**
   * Toggle a single pinned model
   * @param modelId - The ID string of the model to toggle
   */
  const togglePinnedModel = useCallback(
    async (modelId: string) => {
      try {
        const newPinnedModels = pinnedModels.includes(modelId)
          ? pinnedModels.filter((id) => id !== modelId)
          : [...pinnedModels, modelId]
        await updatePinnedModels(newPinnedModels)
      } catch (error) {
        logger.error('Failed to toggle pinned model', error as Error)
      }
    },
    [pinnedModels, updatePinnedModels]
  )

  return { pinnedModels, updatePinnedModels, togglePinnedModel, loading }
}
