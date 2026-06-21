import { loggerService } from '@logger'
import { summarizeTextForLog } from '@renderer/aiCore/utils/logging'
import { PPIO_APP_SECRET, PPIO_CLIENT_ID, SILICON_CLIENT_ID, TOKENFLUX_HOST } from '@renderer/config/constant'
import i18n, { getLanguageCode } from '@renderer/i18n'

import { isHttpExternalUrl } from './openExternal'

const logger = loggerService.withContext('Utils:oauth')
const oauthMessageCleanups = new Map<string, () => void>()
const OAUTH_POPUP_FEATURES =
  'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
const OAUTH_MESSAGE_TIMEOUT_MS = 10 * 60 * 1000
const OAUTH_POPUP_CLOSED_POLL_MS = 1000
const OAUTH_NETWORK_TIMEOUT_MS = 10_000

function replaceOAuthMessageHandler(
  provider: string,
  handler: (event: MessageEvent) => void,
  options: { popup?: Window | null } = {}
) {
  oauthMessageCleanups.get(provider)?.()

  let disposed = false
  window.addEventListener('message', handler)
  const timeoutId = window.setTimeout(() => {
    logger.warn('OAuth message listener timed out', { provider })
    cleanup()
  }, OAUTH_MESSAGE_TIMEOUT_MS)
  const closedPollId = options.popup
    ? window.setInterval(() => {
        if (!options.popup?.closed) return
        logger.debug('OAuth popup closed before callback', { provider })
        cleanup()
      }, OAUTH_POPUP_CLOSED_POLL_MS)
    : null

  const cleanup = () => {
    if (disposed) return
    disposed = true
    window.removeEventListener('message', handler)
    window.clearTimeout(timeoutId)
    if (closedPollId !== null) window.clearInterval(closedPollId)
    if (oauthMessageCleanups.get(provider) === cleanup) {
      oauthMessageCleanups.delete(provider)
    }
  }
  oauthMessageCleanups.set(provider, cleanup)

  return cleanup
}

function openOAuthPopup(url: string, target = 'oauth', features = OAUTH_POPUP_FEATURES) {
  if (!isHttpExternalUrl(url)) {
    logger.warn('Blocked unsafe OAuth URL', { url: summarizeTextForLog(url) })
    window.toast?.error(i18n.t('settings.provider.oauth.error'))
    return null
  }

  const popup = window.open(url, target, features)
  if (!popup) {
    logger.warn('OAuth popup did not open')
    window.toast?.error(i18n.t('settings.provider.oauth.error'))
  }

  return popup
}

function isTrustedOAuthMessage(event: MessageEvent, allowedOrigins: readonly string[]) {
  return allowedOrigins.includes(event.origin)
}

export const oauthWithSiliconFlow = async (setKey) => {
  const authUrl = `https://account.siliconflow.cn/oauth?client_id=${SILICON_CLIENT_ID}`

  const popup = openOAuthPopup(authUrl)
  if (!popup) return

  let cleanup: () => void = () => undefined
  const messageHandler = (event) => {
    if (!isTrustedOAuthMessage(event, ['https://account.siliconflow.cn'])) return

    const payload = event.data
    if (Array.isArray(payload) && payload[0]?.secretKey !== undefined) {
      setKey(payload[0].secretKey)
      popup?.close()
      cleanup()
    }
  }

  cleanup = replaceOAuthMessageHandler('siliconflow', messageHandler, { popup })
}

export const oauthWithAihubmix = async (setKey) => {
  const authUrl = `https://console.aihubmix.com/token?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`

  const popup = openOAuthPopup(authUrl)
  if (!popup) return

  let cleanup: () => void = () => undefined
  const messageHandler = async (event) => {
    if (!isTrustedOAuthMessage(event, ['https://console.aihubmix.com'])) return

    const data = event.data

    if (data?.key === 'cherry_studio_oauth_callback' && data.data) {
      const { iv, encryptedData } = data.data

      try {
        const secret = import.meta.env.RENDERER_VITE_AIHUBMIX_SECRET || ''
        const decryptedData: any = await window.api.aes.decrypt(encryptedData, iv, secret)
        const { api_keys } = JSON.parse(decryptedData)
        if (api_keys && api_keys.length > 0) {
          setKey(api_keys[0].value)
          popup?.close()
          cleanup()
        }
      } catch (error) {
        logger.error('[oauthWithAihubmix] error', error as Error)
        popup?.close()
        cleanup()
        window.toast?.error(i18n.t('settings.provider.oauth.error'))
      }
    }
  }

  cleanup = replaceOAuthMessageHandler('aihubmix', messageHandler, { popup })
}

export const oauthWithPPIO = async (setKey) => {
  const redirectUri = 'cherrystudiopi://'
  const authUrl = `https://ppio.com/oauth/authorize?invited_by=JYT9GD&client_id=${PPIO_CLIENT_ID}&scope=api%20openid&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`

  const popup = openOAuthPopup(authUrl)
  if (!popup) {
    throw new Error('OAuth popup did not open')
  }

  if (!setKey) {
    logger.debug('[PPIO OAuth] No setKey callback provided, returning early')
    return
  }

  logger.debug('[PPIO OAuth] Setting up protocol listener')

  return new Promise<string>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const removeListener = window.api.protocol.onReceiveData(
      async (data) => {
        try {
          const url = new URL(data.url)
          if (url.hostname.toLowerCase() !== 'ppio') return

          const params = new URLSearchParams(url.search)
          const code = params.get('code')

          if (!code) {
            reject(new Error('No authorization code received'))
            return
          }

          if (!PPIO_APP_SECRET) {
            reject(
              new Error(
                'PPIO_APP_SECRET not configured. Please set RENDERER_VITE_PPIO_APP_SECRET environment variable.'
              )
            )
            return
          }
          const formData = new URLSearchParams({
            client_id: PPIO_CLIENT_ID,
            client_secret: PPIO_APP_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
          const tokenResponse = await fetch('https://ppio.com/oauth/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString(),
            signal: AbortSignal.timeout(OAUTH_NETWORK_TIMEOUT_MS)
          })

          if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text()
            logger.error('[PPIO OAuth] Token exchange failed', {
              status: tokenResponse.status,
              error: summarizeTextForLog(errorText)
            })
            throw new Error(`Failed to exchange code for token: ${tokenResponse.status} ${errorText}`)
          }

          const tokenData = await tokenResponse.json()
          const accessToken = tokenData.access_token

          if (accessToken) {
            setKey(accessToken)
            resolve(accessToken)
          } else {
            reject(new Error('No access token received'))
          }
        } catch (error) {
          logger.error('[PPIO OAuth] Error processing callback:', error as Error)
          reject(error)
        } finally {
          cleanup()
        }
      },
      { hosts: 'ppio' }
    )

    function cleanup(): void {
      removeListener()
      if (popup && !popup.closed) {
        popup.close()
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    timeoutId = setTimeout(
      () => {
        logger.warn('[PPIO OAuth] Flow timed out')
        cleanup()
        reject(new Error('OAuth flow timed out'))
      },
      10 * 60 * 1000
    )
  })
}

export const oauthWithTokenFlux = async () => {
  const callbackUrl = `${TOKENFLUX_HOST}/auth/callback?redirect_to=/dashboard/api-keys`
  try {
    const resp = await fetch(`${TOKENFLUX_HOST}/api/auth/auth-url?type=login&callback=${callbackUrl}`, {
      signal: AbortSignal.timeout(10000)
    })
    if (!resp.ok) {
      window.toast?.error(i18n.t('settings.provider.oauth.error'))
      return
    }
    const data = await resp.json()
    const authUrl = data?.data?.url
    if (typeof authUrl !== 'string') {
      window.toast?.error(i18n.t('settings.provider.oauth.error'))
      return
    }
    openOAuthPopup(authUrl)
  } catch (error) {
    logger.error('[oauthWithTokenFlux] error', error as Error)
    window.toast?.error(i18n.t('settings.provider.oauth.error'))
  }
}
export const oauthWith302AI = async (setKey) => {
  const authUrl = 'https://dash.302.ai/sso/login?app=cherry-ai.com&name=Cherry%20Studio'

  const popup = openOAuthPopup(authUrl)
  if (!popup) return

  let cleanup: () => void = () => undefined
  const messageHandler = (event) => {
    if (!isTrustedOAuthMessage(event, ['https://dash.302.ai'])) return

    const apiKey = event.data?.data?.apikey
    if (apiKey !== undefined) {
      setKey(apiKey)
      popup?.close()
      cleanup()
    }
  }

  cleanup = replaceOAuthMessageHandler('302ai', messageHandler, { popup })
}

export const oauthWithAiOnly = async (setKey) => {
  const authUrl = `https://maas.aiionly.com/login?inviteCode=1755481173663DrZBBOC0&cherryCode=01`

  const popup = openOAuthPopup(authUrl, 'login')
  if (!popup) return

  let cleanup: () => void = () => undefined
  const messageHandler = (event) => {
    if (!isTrustedOAuthMessage(event, ['https://maas.aiionly.com'])) return

    const payload = event.data
    if (Array.isArray(payload) && payload[0]?.secretKey !== undefined) {
      setKey(payload[0].secretKey)
      popup?.close()
      cleanup()
    }
  }

  cleanup = replaceOAuthMessageHandler('aionly', messageHandler, { popup })
}

export interface NewApiOAuthConfig {
  oauthServer: string
  apiHost?: string
}

/**
 * CherryIN OAuth flow using Authorization Code with PKCE.
 *
 * PKCE, token exchange and API-key fetch all happen in the main process
 * (`CherryInOauthService`); the deep-link callback is routed by `ProtocolService`
 * directly to this renderer's webContents (captured at `startOAuthFlow` time),
 * so we just await a single point-to-point IPC event keyed by `state`.
 */
export const oauthWithCherryIn = async (
  setKey: (key: string) => void | Promise<void>,
  config: NewApiOAuthConfig
): Promise<string> => {
  const { oauthServer, apiHost } = config

  const { authUrl, state } = await window.api.cherryin.startOAuthFlow(oauthServer, apiHost)

  logger.debug('Opening authorization URL')

  const popup = openOAuthPopup(authUrl)
  if (!popup) {
    throw new Error('OAuth popup did not open')
  }

  return new Promise<string>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const removeListener = window.api.cherryin.onOAuthResult(async (result) => {
      // Defensive: another concurrent CherryIN flow on the same window would
      // hit the same listener; main only ever pushes for our state, but filter
      // anyway to keep the contract explicit.
      if (result.state !== state) return

      cleanup()

      if ('error' in result) {
        logger.error(`OAuth error: ${result.error}`)
        reject(new Error(result.error))
        return
      }

      if (!result.apiKeys) {
        reject(new Error('No API keys received'))
        return
      }

      logger.debug('Successfully obtained API keys')
      try {
        await setKey(result.apiKeys)
      } catch (err) {
        reject(err)
        return
      }
      resolve(result.apiKeys)
    })

    function cleanup(): void {
      removeListener()
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    timeoutId = setTimeout(
      () => {
        logger.warn('Flow timed out')
        cleanup()
        reject(new Error('OAuth flow timed out'))
      },
      10 * 60 * 1000
    )
  })
}

export const providerCharge = async (provider: string) => {
  const chargeUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/expensebill',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.aihubmix.com/topup?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 720,
      height: 900
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/billing',
      width: 900,
      height: 700
    },
    '302ai': {
      url: 'https://dash.302.ai/charge',
      width: 900,
      height: 700
    },
    aionly: {
      url: `https://maas.aiionly.com/recharge`,
      width: 900,
      height: 700
    }
  }

  const charge = chargeUrlMap[provider as keyof typeof chargeUrlMap]
  if (!charge) {
    logger.warn('Unknown provider charge URL requested', { provider })
    window.toast?.error(i18n.t('settings.provider.oauth.error'))
    return
  }

  const { url, width, height } = charge

  openOAuthPopup(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}

export const providerBills = async (provider: string) => {
  const billsUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/bills',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.aihubmix.com/statistics?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 900,
      height: 700
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/billing/billing-details',
      width: 900,
      height: 700
    },
    '302ai': {
      url: 'https://dash.302.ai/charge',
      width: 900,
      height: 700
    },
    aionly: {
      url: `https://maas.aiionly.com/billManagement`,
      width: 900,
      height: 700
    }
  }

  const bills = billsUrlMap[provider as keyof typeof billsUrlMap]
  if (!bills) {
    logger.warn('Unknown provider bills URL requested', { provider })
    window.toast?.error(i18n.t('settings.provider.oauth.error'))
    return
  }

  const { url, width, height } = bills

  openOAuthPopup(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}
