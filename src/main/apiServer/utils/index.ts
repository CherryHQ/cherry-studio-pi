import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ApiServerUtils')

export interface ModelValidationError {
  type: 'invalid_format' | 'provider_not_found' | 'model_not_available'
  message: string
  code: string
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

  let resolvedModel: Model | undefined
  try {
    resolvedModel = (await modelService.getByKey(providerId, modelId)) as unknown as Model
  } catch (error) {
    logger.warn('Failed to resolve model for validation', { providerId, modelId, error })
  }

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

  return { valid: true, provider, model: resolvedModel, modelId }
}
