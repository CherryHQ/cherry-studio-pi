import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import type { Model, Provider } from '@types'

const logger = loggerService.withContext('ModelsServiceCompat')

export type ModelsFilter = {
  limit?: number
  offset?: number
  providerType?: string
}

export type ApiModel = {
  id: string
  object: 'model'
  name: string
  created: number
  owned_by?: string
  provider: string
  provider_name?: string
  provider_type?: string
  provider_model_id: string
}

export type ApiModelsResponse = {
  object: 'list'
  data: ApiModel[]
  total?: number
  offset?: number
  limit?: number
}

function toApiModel(model: Model, provider: Provider): ApiModel {
  return {
    id: `${provider.id}:${model.id}`,
    object: 'model',
    name: model.name || model.id,
    created: Math.floor(Date.now() / 1000),
    owned_by: model.owned_by || provider.name || provider.id,
    provider: provider.id,
    provider_name: provider.name,
    provider_type: provider.type,
    provider_model_id: model.id
  }
}

export const modelsService = {
  async getModels(filter: ModelsFilter = {}): Promise<ApiModelsResponse> {
    try {
      const providers = await reduxService.select<Provider[]>('state.llm.providers').catch(() => [])
      const enabledProviders = (Array.isArray(providers) ? providers : []).filter(
        (provider) => provider.enabled !== false && (!filter.providerType || provider.type === filter.providerType)
      )

      const models = enabledProviders.flatMap((provider) =>
        (Array.isArray(provider.models) ? provider.models : []).map((model) => toApiModel(model, provider))
      )
      const offset = Math.max(0, Number(filter.offset ?? 0))
      const limit = filter.limit === undefined ? undefined : Math.max(0, Number(filter.limit))
      const data = limit === undefined ? models.slice(offset) : models.slice(offset, offset + limit)

      return {
        object: 'list',
        data,
        total: models.length,
        offset,
        ...(limit === undefined ? {} : { limit })
      }
    } catch (error) {
      logger.warn('Failed to list models', error as Error)
      return { object: 'list', data: [] }
    }
  }
}
