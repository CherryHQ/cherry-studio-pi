import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWebSearchProviderCheck')

const WEB_SEARCH_CHECK_KEYWORD = 'Cherry Studio'
const WEB_SEARCH_CHECK_URL = 'https://example.com'

function getProviderCheckErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: { message?: unknown } }
    if (typeof record.error?.message === 'string') return record.error.message
    if (typeof record.message === 'string') return record.message
  }
  return String(error)
}

type UseWebSearchProviderCheckOptions = {
  provider: WebSearchProvider
  capability: WebSearchCapability
}

export function useWebSearchProviderCheck({ provider, capability }: UseWebSearchProviderCheckOptions) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const canCheck = provider.id !== 'fetch'

  const checkProvider = useCallback(() => {
    if (checkingRef.current || !canCheck) {
      return Promise.resolve()
    }

    checkingRef.current = true
    setChecking(true)

    const runCheck = async () => {
      if (capability === 'fetchUrls') {
        await ipcApi.request('web_search.fetch_urls', { providerId: provider.id, urls: [WEB_SEARCH_CHECK_URL] })
      } else {
        await ipcApi.request('web_search.search_keywords', {
          providerId: provider.id,
          keywords: [WEB_SEARCH_CHECK_KEYWORD]
        })
      }
    }

    return runCheck().then(
      () => {
        checkingRef.current = false
        setChecking(false)
        window.toast.success(t('settings.tool.websearch.check_success'))
      },
      (error) => {
        checkingRef.current = false
        setChecking(false)
        logger.error('Web search provider check failed', error as Error)
        const errorMessage = getProviderCheckErrorMessage(error)
        window.toast.error(`${t('settings.tool.websearch.check_failed')}: ${errorMessage}`)
      }
    )
  }, [canCheck, capability, provider.id, t])

  return {
    checking,
    canCheck,
    checkProvider
  }
}
