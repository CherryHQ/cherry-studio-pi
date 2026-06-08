import { loggerService } from '@logger'
import { useCallback } from 'react'

const logger = loggerService.withContext('useNutstoreSso')
export const NUTSTORE_SSO_TIMEOUT_MS = 10 * 60 * 1000
const NUTSTORE_PROTOCOL_HOST = 'nutstore'

export function useNutstoreSso() {
  const nutstoreSsoHandler = useCallback(() => {
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let removeListener: (() => void) | null = null

      const cleanup = () => {
        removeListener?.()
        removeListener = null
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const resolveOnce = (encryptedToken: string) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(encryptedToken)
      }

      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      removeListener = window.api.protocol.onReceiveData(async (data) => {
        try {
          const url = new URL(data.url)
          if (url.hostname.toLowerCase() !== NUTSTORE_PROTOCOL_HOST) return

          const params = new URLSearchParams(url.search)
          const encryptedToken = params.get('s')
          if (!encryptedToken) return
          resolveOnce(encryptedToken)
        } catch (error) {
          logger.error('解析URL失败:', error as Error)
          rejectOnce(error instanceof Error ? error : new Error('Failed to parse Nutstore SSO callback URL'))
        }
      })

      timeoutId = setTimeout(() => {
        logger.warn('坚果云 SSO 登录超时')
        rejectOnce(new Error('Nutstore SSO flow timed out'))
      }, NUTSTORE_SSO_TIMEOUT_MS)
      const maybeNodeTimer = timeoutId as { unref?: () => void }
      maybeNodeTimer.unref?.()
    })
  }, [])

  return nutstoreSsoHandler
}
