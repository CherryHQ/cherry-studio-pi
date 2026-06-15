import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

export function resolveAgentSessionModel(agentModel: string | null | undefined, models: readonly Model[]) {
  if (!agentModel || !isUniqueModelId(agentModel)) return undefined

  const { providerId, modelId } = parseUniqueModelId(agentModel)

  return models.find((model) => {
    if (model.id === agentModel) return true
    if (model.providerId !== providerId) return false

    const modelIdentifier =
      model.apiModelId ?? (isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : undefined)
    return modelIdentifier === modelId
  })
}
