import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('IpService')
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000

let ipCountryCache: { country: string; expiresAt: number } | null = null
let ipCountryPromise: Promise<string> | null = null

/**
 * 获取用户的IP地址所在国家
 * @returns 返回国家代码，默认为'CN'
 */
export function getIpCountry(): Promise<string> {
  const now = Date.now()
  if (ipCountryCache && ipCountryCache.expiresAt > now) {
    return Promise.resolve(ipCountryCache.country)
  }

  ipCountryPromise ??= fetchIpCountry()
    .then(({ country, cacheTtlMs }) => {
      ipCountryCache = { country, expiresAt: Date.now() + cacheTtlMs }
      return country
    })
    .finally(() => {
      ipCountryPromise = null
    })

  return ipCountryPromise
}

async function fetchIpCountry(): Promise<{ country: string; cacheTtlMs: number }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const ipinfo = await net.fetch(`https://api.ipinfo.io/lite/me?token=5aa4105b40adbc`, {
      signal: controller.signal
    })

    const data = await ipinfo.json()
    const country =
      typeof data.country_code === 'string' && data.country_code.trim() ? data.country_code.trim().toUpperCase() : null
    if (!country) {
      logger.warn('IP country lookup returned no country code; defaulting to CN temporarily')
      return { country: 'CN', cacheTtlMs: FALLBACK_CACHE_TTL_MS }
    }

    logger.info(`Detected user IP address country: ${country}`)
    return { country, cacheTtlMs: SUCCESS_CACHE_TTL_MS }
  } catch (error) {
    if (isAbortLikeError(error)) {
      logger.warn('IP country lookup timed out; defaulting to CN temporarily')
      return { country: 'CN', cacheTtlMs: FALLBACK_CACHE_TTL_MS }
    }

    logger.error('Failed to get IP address information:', error as Error)
    return { country: 'CN', cacheTtlMs: FALLBACK_CACHE_TTL_MS }
  } finally {
    clearTimeout(timeoutId)
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || /aborted|abort/i.test(error.message)
}

/**
 * 检查用户是否在中国
 * @returns 如果用户在中国返回true，否则返回false
 */
export async function isUserInChina(): Promise<boolean> {
  const country = await getIpCountry()
  return country.toLowerCase() === 'cn'
}
