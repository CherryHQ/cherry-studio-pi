import type { ApiGatewayConfig } from '@types'

export function summarizeApiServerConfigForLog(config: ApiGatewayConfig) {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    hasApiKey: Boolean(config.apiKey)
  }
}
