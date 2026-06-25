import { loggerService } from '@logger'

const logger = loggerService.withContext('utils:mcp')

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 从npm readme中提取 npx mcp config
 * @param {string} readme readme字符串
 * @returns {Record<string, any> | null} mcp config sample
 */
export function getMcpConfigSampleFromReadme(readme: string): Record<string, any> | null {
  if (readme) {
    const regex = /"mcpServers"\s*:\s*({(?:[^{}]*|{(?:[^{}]*|{[^{}]*})*})*})/g
    for (const match of readme.matchAll(regex)) {
      try {
        const servers = JSON.parse(match[1]) as unknown
        if (!isRecord(servers)) {
          continue
        }

        for (const sample of Object.values(servers)) {
          if (isRecord(sample) && sample.command === 'npx') {
            return sample
          }
        }
      } catch (e) {
        logger.error('getMcpConfigSampleFromReadme', e as Error)
      }
    }
  }
  return null
}
