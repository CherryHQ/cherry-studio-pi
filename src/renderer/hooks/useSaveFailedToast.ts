import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function useSaveFailedToast(messageKey = 'common.save_failed') {
  const { t } = useTranslation()

  return useCallback(
    (error: unknown) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t(messageKey)))
    },
    [messageKey, t]
  )
}
