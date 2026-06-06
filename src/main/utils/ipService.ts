import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('IpService')
let ipCountryPromise: Promise<string> | null = null

/**
 * 获取用户的IP地址所在国家
 * @returns 返回国家代码，默认为'CN'
 */
export function getIpCountry(): Promise<string> {
  ipCountryPromise ??= fetchIpCountry()
  return ipCountryPromise
}

async function fetchIpCountry(): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const ipinfo = await net.fetch(`https://api.ipinfo.io/lite/me?token=5aa4105b40adbc`, {
      signal: controller.signal
    })

    const data = await ipinfo.json()
    const country = typeof data.country_code === 'string' && data.country_code.trim() ? data.country_code : 'CN'
    logger.info(`Detected user IP address country: ${country}`)
    return country
  } catch (error) {
    if (isAbortLikeError(error)) {
      logger.warn('IP country lookup timed out; defaulting to CN')
      return 'CN'
    }

    logger.error('Failed to get IP address information:', error as Error)
    return 'CN'
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
