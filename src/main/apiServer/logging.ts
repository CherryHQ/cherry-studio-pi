import type { ApiGatewayConfig } from '@shared/types/apiGateway'

export function summarizeApiServerConfigForLog(config: ApiGatewayConfig) {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    hasApiKey: Boolean(config.apiKey)
  }
}
