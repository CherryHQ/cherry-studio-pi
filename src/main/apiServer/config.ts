import { application } from '@application'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'

type ApiServerRuntimeConfig = {
  host: string
  port: number
  apiKey?: string
}

function getPreferenceConfig(): ApiServerRuntimeConfig | null | undefined {
  try {
    const preferenceService = application.get('PreferenceService')
    const apiServer = preferenceService.getMultiple({
      enabled: 'feature.api_gateway.enabled',
      host: 'feature.api_gateway.host',
      port: 'feature.api_gateway.port',
      apiKey: 'feature.api_gateway.api_key'
    })

    if (!apiServer.enabled || !apiServer.port) {
      return null
    }

    return {
      host: apiServer.host || API_SERVER_DEFAULTS.HOST,
      port: Number(apiServer.port || API_SERVER_DEFAULTS.PORT),
      apiKey: typeof apiServer.apiKey === 'string' ? apiServer.apiKey : undefined
    }
  } catch {
    return undefined
  }
}

export const config = {
  async get(): Promise<ApiServerRuntimeConfig | null> {
    const preferenceConfig = getPreferenceConfig()
    if (preferenceConfig !== undefined) {
      return preferenceConfig
    }

    return null
  }
}
