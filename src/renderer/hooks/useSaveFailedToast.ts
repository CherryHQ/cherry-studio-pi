import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export function useSaveFailedToast(messageKey = 'common.save_failed') {
  const { t } = useTranslation()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  return useCallback(
    (error: unknown) => {
      if (mountedRef.current) {
        window.toast?.error(formatErrorMessageWithPrefix(error, t(messageKey)))
      }
    },
    [messageKey, t]
  )
}
