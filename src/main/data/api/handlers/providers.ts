/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 */

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { notifyMainProcessDataSyncLocalChange } from '@main/services/appData/DataSyncLocalChangeNotifier'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AddProviderApiKeySchema,
  CreateProviderSchema,
  ListProviderApiKeysQuerySchema,
  ListProvidersQuerySchema,
  type ProviderSchemas,
  ReplaceProviderApiKeysSchema,
  UpdateApiKeySchema,
  UpdateProviderSchema
} from '@shared/data/api/schemas/providers'
import type { ApiKeyEntry, AuthConfig } from '@shared/data/types/provider'

const logger = loggerService.withContext('DataApi:ProviderHandlers')

async function mirrorProviderMetadataToStorageV2(provider: unknown) {
  try {
    await storageV2Service.upsertProviderMetadata(provider as never)
  } catch (error) {
    logger.warn('Failed to mirror provider metadata to Storage v2', {
      error
    })
  }
}

async function mirrorProviderOrderToStorageV2() {
  try {
    const providers = await providerService.list({})
    await Promise.all(
      providers.map((provider, index) => storageV2Service.upsertProviderMetadata(provider as never, index))
    )
  } catch (error) {
    logger.warn('Failed to mirror provider order to Storage v2', {
      error
    })
  }
}

async function mirrorProviderApiKeysToStorageV2(providerId: string, fallbackKeys?: ApiKeyEntry[]) {
  try {
    const keys = fallbackKeys ?? (await providerService.getApiKeys(providerId))
    await storageV2Service.upsertProviderApiKeys(providerId, keys)
  } catch (error) {
    logger.warn('Failed to mirror provider API keys to Storage v2', {
      providerId,
      error
    })
  }
}

async function mirrorProviderAuthConfigToStorageV2(providerId: string, authConfig: AuthConfig | null | undefined) {
  try {
    await storageV2Service.upsertProviderAuthConfig(providerId, authConfig)
  } catch (error) {
    logger.warn('Failed to mirror provider auth config to Storage v2', {
      providerId,
      error
    })
  }
}

async function deleteProviderFromStorageV2(providerId: string) {
  try {
    await storageV2Service.deleteProvider(providerId)
  } catch (error) {
    logger.warn('Failed to delete provider from Storage v2', {
      providerId,
      error
    })
  }
}

function notifyProviderStorageV2Changed(providerId: string, operation: string) {
  notifyMainProcessDataSyncLocalChange('storage-v2', {
    entityType: 'provider',
    providerId,
    operation
  })
}

export const providerHandlers: HandlersFor<ProviderSchemas> = {
  '/providers': {
    GET: async ({ query }) => {
      const parsed = ListProvidersQuerySchema.parse(query ?? {})
      return await providerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateProviderSchema.parse(body)
      const provider = await providerService.create(parsed)
      await mirrorProviderMetadataToStorageV2(provider)
      if (parsed.apiKeys && parsed.apiKeys.length > 0) {
        await mirrorProviderApiKeysToStorageV2(provider.id, parsed.apiKeys)
      }
      if (parsed.authConfig) {
        await mirrorProviderAuthConfigToStorageV2(provider.id, parsed.authConfig)
      }
      notifyProviderStorageV2Changed(provider.id, 'create')
      return provider
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return await providerService.getByProviderId(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateProviderSchema.parse(body)
      const provider = await providerService.update(params.providerId, parsed)
      await mirrorProviderMetadataToStorageV2(provider)
      if (parsed.authConfig !== undefined) {
        await mirrorProviderAuthConfigToStorageV2(params.providerId, parsed.authConfig)
      }
      notifyProviderStorageV2Changed(params.providerId, 'update')
      return provider
    },

    DELETE: async ({ params }) => {
      await providerService.delete(params.providerId)
      await deleteProviderFromStorageV2(params.providerId)
      notifyProviderStorageV2Changed(params.providerId, 'delete')
      return undefined
    }
  },

  '/providers/:providerId/api-keys': {
    GET: async ({ params, query }) => {
      const parsed = ListProviderApiKeysQuerySchema.parse(query ?? {})
      const keys = await providerService.getApiKeys(params.providerId, parsed)
      return { keys }
    },

    POST: async ({ params, body }) => {
      const parsed = AddProviderApiKeySchema.parse(body)
      const provider = await providerService.addApiKey(params.providerId, parsed.key, parsed.label)
      await mirrorProviderMetadataToStorageV2(provider)
      await mirrorProviderApiKeysToStorageV2(params.providerId)
      notifyProviderStorageV2Changed(params.providerId, 'api-key:add')
      return provider
    },

    PUT: async ({ params, body }) => {
      const parsed = ReplaceProviderApiKeysSchema.parse(body)
      const provider = await providerService.replaceApiKeys(params.providerId, parsed.keys)
      await mirrorProviderMetadataToStorageV2(provider)
      await mirrorProviderApiKeysToStorageV2(params.providerId, parsed.keys)
      notifyProviderStorageV2Changed(params.providerId, 'api-key:replace')
      return provider
    }
  },

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
      return providerService.getAuthConfig(params.providerId)
    }
  },

  '/providers/:providerId/api-keys/:keyId': {
    PATCH: async ({ params, body }) => {
      const parsed = UpdateApiKeySchema.parse(body)
      const provider = await providerService.updateApiKey(params.providerId, params.keyId, parsed)
      await mirrorProviderMetadataToStorageV2(provider)
      await mirrorProviderApiKeysToStorageV2(params.providerId)
      notifyProviderStorageV2Changed(params.providerId, 'api-key:update')
      return provider
    },

    DELETE: async ({ params }) => {
      const provider = await providerService.deleteApiKey(params.providerId, params.keyId)
      await mirrorProviderMetadataToStorageV2(provider)
      await mirrorProviderApiKeysToStorageV2(params.providerId)
      notifyProviderStorageV2Changed(params.providerId, 'api-key:delete')
      return provider
    }
  },

  '/providers/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await providerService.move(params.id, parsed)
      await mirrorProviderOrderToStorageV2()
      notifyProviderStorageV2Changed(params.id, 'order:update')
      return undefined
    }
  },

  '/providers/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await providerService.reorder(parsed.moves)
      await mirrorProviderOrderToStorageV2()
      notifyMainProcessDataSyncLocalChange('storage-v2', {
        entityType: 'provider',
        providerIds: parsed.moves.map((move) => move.id),
        operation: 'order:batch'
      })
      return undefined
    }
  }
}
