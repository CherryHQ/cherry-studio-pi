import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ModelValidation')

export interface ModelValidationError {
  type: 'invalid_format' | 'provider_not_found' | 'model_not_available'
  message: string
  code: string
}

function getRuntimeApiModelId(model: Model): string {
  const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : ''
  if (apiModelId) return apiModelId

  return isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : model.id
}

function selectSingleModelMatch(
  providerId: string,
  requestedModelId: string,
  storedModelId: UniqueModelId,
  models: Model[]
) {
  if (models.length === 0) return undefined

  const exactMatches = models.filter((candidate) => candidate.id === storedModelId)
  if (exactMatches.length === 1) return exactMatches[0]

  const runnableMatches = models.filter((candidate) => candidate.isEnabled !== false && candidate.isHidden !== true)
  if (runnableMatches.length === 1) return runnableMatches[0]

  if (models.length === 1) return models[0]

  logger.warn('Ambiguous model validation alias match', {
    providerId,
    requestedModelId,
    candidates: models.map((candidate) => ({
      id: candidate.id,
      apiModelId: candidate.apiModelId,
      isEnabled: candidate.isEnabled,
      isHidden: candidate.isHidden
    }))
  })
  return undefined
}

async function resolveModelForValidation(
  providerId: string,
  requestedModelId: string,
  storedModelId: UniqueModelId
): Promise<Model | undefined> {
  try {
    return (await modelService.getByKey(providerId, requestedModelId)) as unknown as Model
  } catch (directLookupError) {
    try {
      const providerModels = (await modelService.list({ providerId })) as unknown as Model[]
      const matches = providerModels.filter(
        (candidate) => candidate.id === storedModelId || getRuntimeApiModelId(candidate) === requestedModelId
      )
      const resolved = selectSingleModelMatch(providerId, requestedModelId, storedModelId, matches)
      if (resolved) return resolved
    } catch (fallbackLookupError) {
      logger.warn('Failed to resolve provider models for validation fallback', {
        providerId,
        requestedModelId,
        fallbackLookupError
      })
    }

    logger.warn('Failed to resolve model for validation', { providerId, requestedModelId, directLookupError })
    return undefined
  }
}

export async function validateModelId(model: string): Promise<{
  valid: boolean
  error?: ModelValidationError
  provider?: Provider
  model?: Model
  modelId?: string
}> {
  if (!model || typeof model !== 'string') {
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: "Invalid model format. Expected 'provider::model_id'.",
        code: 'invalid_model_format'
      }
    }
  }

  let providerId: string
  let modelId: string
  try {
    const parsed = parseUniqueModelId(model as UniqueModelId)
    providerId = parsed.providerId
    modelId = parsed.modelId
  } catch {
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: "Invalid model format. Expected 'provider::model_id'.",
        code: 'invalid_model_format'
      }
    }
  }

  if (!providerId || !modelId) {
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: "Invalid model format. Expected non-empty 'provider::model_id'.",
        code: 'invalid_model_format'
      }
    }
  }

  let provider: Provider | undefined
  try {
    provider = (await providerService.getByProviderId(providerId)) as unknown as Provider
  } catch (error) {
    logger.warn('Failed to resolve provider for model validation', { providerId, error })
  }

  if (
    !provider ||
    (provider as { enabled?: boolean; isEnabled?: boolean }).enabled === false ||
    provider.isEnabled === false
  ) {
    return {
      valid: false,
      error: {
        type: 'provider_not_found',
        message: `Provider '${providerId}' was not found or is disabled.`,
        code: 'provider_not_found'
      }
    }
  }

  const resolvedModel = await resolveModelForValidation(providerId, modelId, model as UniqueModelId)

  if (
    !resolvedModel ||
    (resolvedModel as { enabled?: boolean; isEnabled?: boolean }).enabled === false ||
    resolvedModel.isEnabled === false
  ) {
    return {
      valid: false,
      error: {
        type: 'model_not_available',
        message: `Model '${modelId}' is not available in provider '${providerId}'.`,
        code: 'model_not_available'
      }
    }
  }

  return { valid: true, provider, model: resolvedModel, modelId: getRuntimeApiModelId(resolvedModel) }
}
