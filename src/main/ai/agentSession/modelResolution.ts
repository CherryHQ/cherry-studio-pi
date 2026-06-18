import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

export function getAgentRuntimeApiModelId(model: Model): string {
  const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : ''
  if (apiModelId) return apiModelId

  return isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : model.id
}

function selectSingleModelMatch(agentId: string, storedModelId: string, models: Model[]): Model | null {
  if (models.length === 0) return null

  const exactMatches = models.filter((model) => model.id === storedModelId)
  if (exactMatches.length === 1) return exactMatches[0]

  const runnableMatches = models.filter((model) => model.isEnabled !== false && model.isHidden !== true)
  if (runnableMatches.length === 1) return runnableMatches[0]

  if (models.length === 1) return models[0]

  const candidates = models
    .map((model) => `${model.id}${model.apiModelId ? ` (api: ${model.apiModelId})` : ''}`)
    .join(', ')
  throw new Error(`Agent ${agentId} model "${storedModelId}" is ambiguous; candidates: ${candidates}`)
}

async function resolveUniqueStoredModel(agentId: string, storedModelId: UniqueModelId): Promise<Model | null> {
  const { providerId, modelId } = parseUniqueModelId(storedModelId)

  try {
    return await modelService.getByKey(providerId, modelId)
  } catch {
    // Keep going: some restored/legacy rows store provider::apiModelId while
    // user_model.id uses a provider-specific canonical id.
  }

  const providerModels = await modelService.list({ providerId })
  const matches = providerModels.filter(
    (model) => model.id === storedModelId || getAgentRuntimeApiModelId(model) === modelId
  )
  const registeredMatch = selectSingleModelMatch(agentId, storedModelId, matches)
  if (registeredMatch) return registeredMatch

  if (providerModels.length > 0) return null

  // Match the renderer-side agent-session fallback: a synced/restored agent can
  // briefly keep only `provider::model` while its user_model rows have not
  // arrived yet. If the provider itself exists, the registry resolver returns a
  // fully-shaped preset/custom model so the agent runtime can still start.
  const registryModels = await providerRegistryService.resolveModels(providerId, [modelId])
  return selectSingleModelMatch(agentId, storedModelId, registryModels)
}

export async function resolveAgentRuntimeModel(
  agent: Pick<AgentEntity, 'id'> & { model?: string | null }
): Promise<Model> {
  const storedModelId = agent.model?.trim()
  if (!storedModelId) {
    throw new Error(`Agent ${agent.id} has no model configured`)
  }

  const model = isUniqueModelId(storedModelId)
    ? await resolveUniqueStoredModel(agent.id, storedModelId)
    : selectSingleModelMatch(
        agent.id,
        storedModelId,
        (await modelService.list({})).filter(
          (candidate) => candidate.id === storedModelId || getAgentRuntimeApiModelId(candidate) === storedModelId
        )
      )

  if (!model) {
    throw new Error(`Agent ${agent.id} model "${storedModelId}" is not registered in user_model`)
  }
  if (!isUniqueModelId(model.id)) {
    throw new Error(`Agent ${agent.id} resolved model "${model.id}" is not a valid UniqueModelId`)
  }

  return model
}
