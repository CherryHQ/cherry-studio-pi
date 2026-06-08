import type { ApiServerConfig } from '@types'

export function summarizeApiServerConfigForLog(config: ApiServerConfig) {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    hasApiKey: Boolean(config.apiKey)
  }
}
