import type { ModelSnapshot } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

export function createModelSnapshot(model: Model): ModelSnapshot {
  const parsed = isUniqueModelId(model.id) ? parseUniqueModelId(model.id) : undefined
  const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : ''

  return {
    id: apiModelId || parsed?.modelId || model.id,
    name: model.name,
    provider: model.providerId || parsed?.providerId || ''
  }
}
