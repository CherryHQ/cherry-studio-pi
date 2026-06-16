import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

export function getModelRawIdentifier(model: Model): string {
  const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : ''
  if (apiModelId) return apiModelId
  return isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : model.id
}

export function resolveAgentSessionModel(agentModel: string | null | undefined, models: readonly Model[]) {
  const normalizedAgentModel = agentModel?.trim()
  if (!normalizedAgentModel) return undefined

  if (!isUniqueModelId(normalizedAgentModel)) {
    return models.find(
      (model) => model.id === normalizedAgentModel || getModelRawIdentifier(model) === normalizedAgentModel
    )
  }

  const { providerId, modelId } = parseUniqueModelId(normalizedAgentModel)

  return models.find((model) => {
    if (model.id === normalizedAgentModel) return true
    if (model.providerId !== providerId) return false

    return getModelRawIdentifier(model) === modelId
  })
}

export function createAgentSessionModelFallback(agentModel: string | null | undefined): Model | undefined {
  const normalizedAgentModel = agentModel?.trim()
  if (!normalizedAgentModel || !isUniqueModelId(normalizedAgentModel)) return undefined

  const { providerId, modelId } = parseUniqueModelId(normalizedAgentModel)
  if (!providerId || !modelId) return undefined

  return {
    id: normalizedAgentModel,
    providerId,
    apiModelId: modelId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

export function resolveAgentSessionModelForDisplay(agentModel: string | null | undefined, models: readonly Model[]) {
  return resolveAgentSessionModel(agentModel, models) ?? createAgentSessionModelFallback(agentModel)
}
