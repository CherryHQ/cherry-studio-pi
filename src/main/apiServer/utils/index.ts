import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import type { Model, Provider } from '@types'

const logger = loggerService.withContext('ApiServerUtils')

export interface ModelValidationError {
  type: 'invalid_format' | 'provider_not_found' | 'model_not_available'
  message: string
  code: string
}

function getRealProviderModel(model: string): string {
  return model.split(':').slice(1).join(':')
}

async function getProviders(): Promise<Provider[]> {
  try {
    const providers = await reduxService.select<Provider[]>('state.llm.providers')
    return Array.isArray(providers) ? providers : []
  } catch (error) {
    logger.warn('Failed to read providers from Redux state', error as Error)
    return []
  }
}

function getProviderModels(provider: Provider): Model[] {
  return Array.isArray(provider.models) ? provider.models : []
}

export async function validateModelId(model: string): Promise<{
  valid: boolean
  error?: ModelValidationError
  provider?: Provider
  modelId?: string
}> {
  if (!model || typeof model !== 'string' || !model.includes(':')) {
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: "Invalid model format. Expected 'provider:model_id'.",
        code: 'invalid_model_format'
      }
    }
  }

  const providerId = model.split(':')[0]
  const modelId = getRealProviderModel(model)
  if (!providerId || !modelId) {
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: "Invalid model format. Expected non-empty 'provider:model_id'.",
        code: 'invalid_model_format'
      }
    }
  }

  const provider = (await getProviders()).find((item) => item.id === providerId)
  if (!provider || provider.enabled === false) {
    return {
      valid: false,
      error: {
        type: 'provider_not_found',
        message: `Provider '${providerId}' was not found or is disabled.`,
        code: 'provider_not_found'
      }
    }
  }

  const models = getProviderModels(provider)
  if (models.length > 0 && !models.some((item) => item.id === modelId)) {
    return {
      valid: false,
      error: {
        type: 'model_not_available',
        message: `Model '${modelId}' is not available in provider '${providerId}'.`,
        code: 'model_not_available'
      }
    }
  }

  return { valid: true, provider, modelId }
}
