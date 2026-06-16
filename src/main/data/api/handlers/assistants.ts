/**
 * Assistant API Handlers
 *
 * Implements all assistant-related API endpoints including:
 * - Assistant CRUD operations
 * - Listing with optional filters
 *
 * All input validation happens here at the system boundary.
 */

import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { AssistantSchemas } from '@shared/data/api/schemas/assistants'
import {
  ASSISTANTS_MAX_LIMIT,
  CreateAssistantSchema,
  ListAssistantsQuerySchema,
  UpdateAssistantSchema
} from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'

const logger = loggerService.withContext('DataApi:AssistantHandlers')

async function listOrderedAssistantsForStorageV2(): Promise<Assistant[]> {
  const assistants: Assistant[] = []

  for (let page = 1; page <= 100; page++) {
    const result = await assistantDataService.list({
      page,
      limit: ASSISTANTS_MAX_LIMIT,
      sortBy: 'orderKey',
      sortOrder: 'asc'
    })
    assistants.push(...result.items)

    if (assistants.length >= result.total || result.items.length < ASSISTANTS_MAX_LIMIT) {
      break
    }
  }

  return assistants
}

async function mirrorAssistantsToStorageV2(reason: string, onlyIds?: Iterable<string>) {
  try {
    const onlyIdSet = onlyIds ? new Set(onlyIds) : null
    const assistants = await listOrderedAssistantsForStorageV2()

    for (const [index, assistant] of assistants.entries()) {
      if (onlyIdSet && !onlyIdSet.has(assistant.id)) continue
      await storageV2Service.upsertAssistant(assistant, index)
    }
  } catch (error) {
    logger.warn('Failed to mirror assistants to Storage v2', {
      reason,
      error
    })
  }
}

async function deleteAssistantFromStorageV2(assistantId: string) {
  try {
    await storageV2Service.deleteAssistant(assistantId)
  } catch (error) {
    logger.warn('Failed to delete assistant from Storage v2', {
      assistantId,
      error
    })
  }
}

export const assistantHandlers: HandlersFor<AssistantSchemas> = {
  '/assistants': {
    GET: async ({ query }) => {
      const parsed = ListAssistantsQuerySchema.parse(query ?? {})
      return await assistantDataService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateAssistantSchema.parse(body)
      const assistant = await assistantDataService.create(parsed)
      await mirrorAssistantsToStorageV2('create', [assistant.id])
      return assistant
    }
  },

  '/assistants/:id': {
    GET: async ({ params }) => {
      return await assistantDataService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAssistantSchema.parse(body)
      // Entity schema fields like `prompt` / `emoji` / `settings` carry `.default()`,
      // and `.partial()` does not strip those — `.parse({ tagIds: [...] })` would inject
      // defaults for every omitted field and the service would overwrite the row with them.
      // Keep only keys actually present in the request body so PATCH stays partial.
      const bodyKeys = body && typeof body === 'object' ? new Set(Object.keys(body)) : new Set<string>()
      const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => bodyKeys.has(key)))
      const assistant = await assistantDataService.update(params.id, patch)
      await mirrorAssistantsToStorageV2('update', [assistant.id])
      return assistant
    },

    DELETE: async ({ params }) => {
      await assistantDataService.delete(params.id)
      await deleteAssistantFromStorageV2(params.id)
      await mirrorAssistantsToStorageV2('delete')
      return undefined
    }
  },

  '/assistants/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await assistantDataService.reorder(params.id, parsed)
      await mirrorAssistantsToStorageV2('reorder')
      return undefined
    }
  },

  '/assistants/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await assistantDataService.reorderBatch(parsed.moves)
      await mirrorAssistantsToStorageV2('reorderBatch')
      return undefined
    }
  }
}
