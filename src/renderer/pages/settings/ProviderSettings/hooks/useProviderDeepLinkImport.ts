import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import type { ProviderType } from '@renderer/types'
import { validateApiHost } from '@renderer/utils'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'

const logger = loggerService.withContext('useProviderDeepLinkImport')

function resolveDefaultEndpoint(type?: string): EndpointType {
  switch (type) {
    case 'anthropic':
    case 'vertex-anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'openai-response':
      return ENDPOINT_TYPE.OPENAI_RESPONSES
    case 'gemini':
    case 'vertexai':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'ollama':
      return ENDPOINT_TYPE.OLLAMA_CHAT
    default:
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }
}

interface ImportedProviderSearchData {
  id: string
  apiKey: string
  baseUrl: string
  type?: ProviderType
  name?: string
}

function parseProviderSearchData(value: string): ImportedProviderSearchData | null {
  const parsed = JSON.parse(value) as unknown

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
  const type = typeof record.type === 'string' ? (record.type as ProviderType) : undefined
  const name = typeof record.name === 'string' ? record.name.trim() : undefined

  if (!id || !apiKey || !baseUrl) {
    return null
  }

  return {
    id,
    apiKey,
    baseUrl,
    ...(type ? { type } : {}),
    ...(name ? { name } : {})
  }
}

/** Consumes one provider deep-link import payload from the URL into create/update + add-api-key calls. */
export function useProviderDeepLinkImport(
  searchAddProviderData: string | undefined,
  onSelectProvider: (providerId: string) => void
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const { trigger: addApiKeyTrigger } = useMutation('POST', '/providers/:providerId/api-keys', {
    refresh: ({ args }) => [
      '/providers',
      `/providers/${args!.params.providerId}`,
      `/providers/${args!.params.providerId}/*`,
      '/models',
      '/pins'
    ]
  })

  useEffect(() => {
    if (!searchAddProviderData) {
      return
    }

    let active = true
    const isActive = () => active

    const importProvider = async (providerData: ImportedProviderSearchData) => {
      try {
        const popupResult = await UrlSchemaInfoPopup.show(providerData)
        if (!isActive()) {
          return
        }
        const { updatedProvider, isNew, displayName } = popupResult

        if (!updatedProvider) {
          void navigate({ to: '/settings/provider' })
          return
        }

        const providerId = updatedProvider.id
        const defaultChatEndpoint = resolveDefaultEndpoint(updatedProvider.type)
        if (updatedProvider.apiHost && !validateApiHost(updatedProvider.apiHost)) {
          logger.warn('Rejected deep-link apiHost with invalid scheme', { providerId })
          window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
          void navigate({ to: '/settings/provider' })
          return
        }
        const endpointConfigs = updatedProvider.apiHost
          ? {
              [defaultChatEndpoint]: {
                baseUrl: updatedProvider.apiHost
              }
            }
          : undefined

        if (isNew) {
          await createProvider({
            providerId,
            name: updatedProvider.name || providerData.id,
            defaultChatEndpoint,
            endpointConfigs
          })
        } else {
          await updateProviderById(providerId, {
            name: updatedProvider.name,
            defaultChatEndpoint,
            endpointConfigs
          })
        }

        if (updatedProvider.apiKey.trim()) {
          await addApiKeyTrigger({
            params: { providerId },
            body: { key: updatedProvider.apiKey.trim() }
          })
        }

        if (isActive()) {
          onSelectProvider(providerId)
          void navigate({ to: '/settings/provider', search: { id: providerId } })
          window.toast.success(t('settings.models.provider_key_added', { provider: displayName }))
        }
      } catch (error) {
        if (!isActive()) {
          return
        }
        logger.error('Failed to import provider deep link data', error as Error)
        window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
      }
    }

    try {
      const parsed = parseProviderSearchData(searchAddProviderData)
      if (!parsed) {
        window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
        return
      }

      void importProvider(parsed)
    } catch (error) {
      logger.error('Failed to parse provider deep link import data', error as Error)
      window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    }

    return () => {
      active = false
    }
  }, [addApiKeyTrigger, createProvider, navigate, onSelectProvider, searchAddProviderData, t, updateProviderById])
}
