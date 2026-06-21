import { Button, InfoTooltip, Input, RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSaveFailedToast } from '@renderer/hooks/useSaveFailedToast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('SiyuanSettings')
const INTEGRATION_CHECK_TIMEOUT_MS = 10_000

const SiyuanSettings: FC = () => {
  const [siyuanApiUrl, setSiyuanApiUrl] = usePreference('data.integration.siyuan.api_url')
  const [siyuanToken, setSiyuanToken] = usePreference('data.integration.siyuan.token')
  const [siyuanBoxId, setSiyuanBoxId] = usePreference('data.integration.siyuan.box_id')
  const [siyuanRootPath, setSiyuanRootPath] = usePreference('data.integration.siyuan.root_path')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const [checkingConnection, setCheckingConnection] = useState(false)
  const checkingConnectionRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const showSaveFailed = useSaveFailedToast()

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setSiyuanApiUrl(e.target.value).catch(showSaveFailed)
  }

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setSiyuanToken(e.target.value).catch(showSaveFailed)
  }

  const handleBoxIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setSiyuanBoxId(e.target.value).catch(showSaveFailed)
  }

  const handleRootPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setSiyuanRootPath(e.target.value).catch(showSaveFailed)
  }

  const handleSiyuanHelpClick = () => {
    void window.api.openWebsite('https://docs.cherry-ai.com/advanced-basic/siyuan').catch((error) => {
      logger.error('Failed to open Siyuan documentation', error as Error)
      window.toast?.error(formatErrorMessageWithPrefix(error, t('common.operation_failed')))
    })
  }

  const handleCheckConnection = async () => {
    if (checkingConnectionRef.current) {
      return
    }

    try {
      if (!siyuanApiUrl || !siyuanToken) {
        window.toast?.error(t('settings.data.siyuan.check.empty_config'))
        return
      }

      checkingConnectionRef.current = true
      setCheckingConnection(true)
      const response = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
        method: 'POST',
        signal: AbortSignal.timeout(INTEGRATION_CHECK_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${siyuanToken}`
        }
      })

      if (!mountedRef.current) {
        return
      }

      if (!response.ok) {
        window.toast?.error(t('settings.data.siyuan.check.fail'))
        return
      }

      const data = await response.json()
      if (!mountedRef.current) {
        return
      }

      if (data.code !== 0) {
        window.toast?.error(t('settings.data.siyuan.check.fail'))
        return
      }

      window.toast?.success(t('settings.data.siyuan.check.success'))
    } catch (error) {
      logger.error('Check Siyuan connection failed:', error as Error)
      if (mountedRef.current) {
        window.toast?.error(t('settings.data.siyuan.check.error'))
      }
    } finally {
      checkingConnectionRef.current = false
      if (mountedRef.current) {
        setCheckingConnection(false)
      }
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.siyuan.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.api_url')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleApiUrlChange}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.siyuan.token.label')}</span>
          <InfoTooltip
            content={t('settings.data.siyuan.token.help')}
            placement="left"
            iconProps={{ className: 'text-text-2 cursor-pointer ml-1' }}
            onClick={handleSiyuanHelpClick}
          />
        </SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <RowFlex className="w-full min-w-0 items-center gap-1.25">
            <Input
              type="password"
              value={siyuanToken || ''}
              onChange={handleTokenChange}
              onBlur={handleTokenChange}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button
              onClick={handleCheckConnection}
              variant="outline"
              className="h-9 shrink-0"
              disabled={checkingConnection}
              loading={checkingConnection}>
              {t('settings.data.siyuan.check.button')}
            </Button>
          </RowFlex>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleBoxIdChange}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleRootPathChange}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default SiyuanSettings
