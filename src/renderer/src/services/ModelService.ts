import { getStoreProviders } from '@renderer/hooks/useStore'
import type { Model } from '@renderer/types'
import { pick } from 'lodash'

import { getProviderName } from './ProviderService'

export const getModelUniqId = (m?: Model) => {
  return m?.id ? JSON.stringify(pick(m, ['id', 'provider'])) : ''
}

export const parseModelUniqId = (value: unknown): Pick<Model, 'id' | 'provider'> | null => {
  if (typeof value !== 'string' || !value) return null

  try {
    const parsed = JSON.parse(value) as Partial<Pick<Model, 'id' | 'provider'>>
    if (typeof parsed.id !== 'string' || typeof parsed.provider !== 'string') return null
    return { id: parsed.id, provider: parsed.provider }
  } catch {
    return null
  }
}

export const findModelByUniqId = (models: Model[], value: unknown) => {
  const parsed = parseModelUniqId(value)
  if (!parsed) return undefined
  return models.find((model) => model.id === parsed.id && model.provider === parsed.provider)
}

export const hasModel = (m?: Model) => {
  if (!m?.id || !m.provider) return false

  return getStoreProviders().some((provider) => {
    if (!provider.enabled || provider.id !== m.provider) return false
    return provider.models.some((model) => model.id === m.id && (model.provider ?? provider.id) === m.provider)
  })
}

export function getModelName(model?: Model) {
  const modelName = model?.name || model?.id || ''
  const provider = getStoreProviders().find((p) => p.id === model?.provider)

  if (provider) {
    const providerName = getProviderName(model as Model)
    return `${modelName} | ${providerName}`
  }

  return modelName
}

export function getModelById(modelId: string) {
  for (const provider of getStoreProviders()) {
    if (!provider.enabled) continue
    const model = provider.models.find((m) => m.id === modelId)
    if (model) return model.provider ? model : { ...model, provider: provider.id }
  }

  return undefined
}
