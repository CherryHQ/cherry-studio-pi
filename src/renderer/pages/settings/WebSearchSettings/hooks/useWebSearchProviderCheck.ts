import { loggerService } from '@logger'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWebSearchProviderCheck')

const WEB_SEARCH_CHECK_KEYWORD = 'Cherry Studio'
const WEB_SEARCH_CHECK_URL = 'https://example.com'

type UseWebSearchProviderCheckOptions = {
  provider: WebSearchProvider
  capability: WebSearchCapability
}

export function useWebSearchProviderCheck({ provider, capability }: UseWebSearchProviderCheckOptions) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const canCheck = provider.id !== 'fetch'

  const checkProvider = useCallback(async () => {
    if (checkingRef.current || !canCheck) {
      return
    }

    checkingRef.current = true
    setChecking(true)

    const runCheck = async () => {
      if (capability === 'fetchUrls') {
        await window.api.webSearch.fetchUrls({ providerId: provider.id, urls: [WEB_SEARCH_CHECK_URL] })
      } else {
        await window.api.webSearch.searchKeywords({ providerId: provider.id, keywords: [WEB_SEARCH_CHECK_KEYWORD] })
      }
    }

    try {
      await runCheck()
      window.toast?.success(t('settings.tool.websearch.check_success'))
    } catch (error) {
      logger.error('Web search provider check failed', error as Error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      window.toast?.error(`${t('settings.tool.websearch.check_failed')}: ${errorMessage}`)
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [canCheck, capability, provider.id, t])

  return {
    checking,
    canCheck,
    checkProvider
  }
}
