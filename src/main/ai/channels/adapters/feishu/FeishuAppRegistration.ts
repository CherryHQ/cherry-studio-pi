/**
 * Feishu App Registration via Device Flow.
 *
 * Implements the `/oauth/v1/app/registration` endpoint used by openclaw-lark
 * to create a PersonalAgent self-built app by scanning a QR code.
 *
 * Flow: init -> begin (returns QR URL) -> poll (returns client_id + client_secret)
 */
import { loggerService } from '@logger'
import type { FeishuDomain } from '@shared/data/types/channel'
import { net } from 'electron'

const logger = loggerService.withContext('FeishuAppRegistration')

const BASE_URLS: Record<FeishuDomain, string> = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com'
}
const REGISTRATION_REQUEST_TIMEOUT_MS = 30_000

type RegistrationBeginResult = {
  deviceCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type RegistrationResult = {
  appId: string
  appSecret: string
  openId?: string
}

type PollStatus = 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token'

function createRegistrationAbortError(): Error {
  return new Error('Registration polling aborted')
}

function summarizeRegistrationResponse(response: Record<string, unknown>): {
  error?: string
  keyCount: number
  keys: string[]
} {
  const keys = Object.keys(response).sort()
  const error = typeof response.error === 'string' ? response.error : undefined
  return {
    ...(error ? { error } : {}),
    keyCount: keys.length,
    keys
  }
}

function waitForPollInterval(intervalMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createRegistrationAbortError())
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(createRegistrationAbortError())
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, intervalMs)
    if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function postRegistration(
  baseUrl: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const url = `${baseUrl}/oauth/v1/app/registration`
  // The Feishu registration API requires application/x-www-form-urlencoded,
  // matching the format used by @larksuiteoapi/openclaw-lark-tools.
  const body = new URLSearchParams(params).toString()
  const timeoutSignal = AbortSignal.timeout(REGISTRATION_REQUEST_TIMEOUT_MS)
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  })

  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Invalid JSON from Feishu registration API (response length: ${text.length})`)
  }
}

export async function registrationBegin(domain: FeishuDomain): Promise<RegistrationBeginResult> {
  const baseUrl = BASE_URLS[domain]

  // Step 1: init — check supported auth methods
  const initRes = await postRegistration(baseUrl, { action: 'init' })
  logger.info('Feishu registration init response', summarizeRegistrationResponse(initRes))

  // Step 2: begin — start device flow
  const res = await postRegistration(baseUrl, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id'
  })

  const deviceCode = res.device_code as string | undefined
  const verificationUri = res.verification_uri_complete as string | undefined

  if (!deviceCode || !verificationUri) {
    const summary = summarizeRegistrationResponse(res)
    throw new Error(
      `Feishu registration begin failed: missing required fields (keys: ${summary.keys.join(', ') || 'none'})`
    )
  }

  return {
    deviceCode,
    verificationUri,
    interval: (res.interval as number) ?? 5,
    expiresIn: (res.expires_in as number) ?? 600
  }
}

export async function registrationPoll(
  domain: FeishuDomain,
  deviceCode: string,
  options: { interval: number; expiresIn: number; signal?: AbortSignal }
): Promise<RegistrationResult> {
  const baseUrl = BASE_URLS[domain]
  const deadline = Date.now() + options.expiresIn * 1000
  let interval = options.interval * 1000

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw createRegistrationAbortError()
    }

    await waitForPollInterval(interval, options.signal)

    if (options.signal?.aborted) {
      throw createRegistrationAbortError()
    }

    const res = await postRegistration(
      baseUrl,
      {
        action: 'poll',
        device_code: deviceCode
      },
      options.signal
    )

    // Success: got credentials
    if (res.client_id && res.client_secret) {
      const userInfo = res.user_info as Record<string, string> | undefined
      logger.info('Feishu app registration succeeded')
      return {
        appId: res.client_id as string,
        appSecret: res.client_secret as string,
        openId: userInfo?.open_id
      }
    }

    // Handle error states
    const error = (res.error as string) ?? ''
    switch (error as PollStatus) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5000
        continue
      case 'access_denied':
        throw new Error('User denied the Feishu app registration')
      case 'expired_token':
        throw new Error('Feishu app registration QR code expired')
      default:
        if (error) {
          throw new Error(`Feishu registration poll error: ${error}`)
        }
        continue
    }
  }

  throw new Error('Feishu app registration timed out')
}
