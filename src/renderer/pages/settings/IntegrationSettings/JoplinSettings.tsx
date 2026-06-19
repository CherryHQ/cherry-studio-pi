import { Button, InfoTooltip, Input, RowFlex, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSaveFailedToast } from '@renderer/hooks/useSaveFailedToast'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('JoplinSettings')
const INTEGRATION_CHECK_TIMEOUT_MS = 10_000

function buildJoplinNotesCheckUrl(baseUrl: string, token: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL('notes', normalizedBaseUrl)
  url.searchParams.set('limit', '1')
  url.searchParams.set('token', token)
  return url.toString()
}

const JoplinSettings: FC = () => {
  const [joplinToken, setJoplinToken] = usePreference('data.integration.joplin.token')
  const [joplinUrl, setJoplinUrl] = usePreference('data.integration.joplin.url')
  const [joplinExportReasoning, setJoplinExportReasoning] = usePreference('data.integration.joplin.export_reasoning')

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

  const handleJoplinTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setJoplinToken(e.target.value).catch(showSaveFailed)
  }

  const handleJoplinUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setJoplinUrl(e.target.value).catch(showSaveFailed)
  }

  const handleJoplinUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      void setJoplinUrl(url).catch(showSaveFailed)
    }
  }

  const handleJoplinConnectionCheck = async () => {
    if (checkingConnectionRef.current) {
      return
    }

    try {
      if (!joplinToken) {
        window.toast.error(t('settings.data.joplin.check.empty_token'))
        return
      }
      if (!joplinUrl) {
        window.toast.error(t('settings.data.joplin.check.empty_url'))
        return
      }

      checkingConnectionRef.current = true
      setCheckingConnection(true)
      const response = await fetch(buildJoplinNotesCheckUrl(joplinUrl, joplinToken), {
        signal: AbortSignal.timeout(INTEGRATION_CHECK_TIMEOUT_MS)
      })

      const data = await response.json()

      if (!mountedRef.current) {
        return
      }

      if (!response.ok || data?.error) {
        window.toast.error(t('settings.data.joplin.check.fail'))
        return
      }

      window.toast.success(t('settings.data.joplin.check.success'))
    } catch (error) {
      logger.error('Failed to check Joplin connection', error as Error)
      if (mountedRef.current) {
        window.toast.error(`${t('settings.data.joplin.check.fail')}: ${formatErrorMessage(error)}`)
      }
    } finally {
      checkingConnectionRef.current = false
      if (mountedRef.current) {
        setCheckingConnection(false)
      }
    }
  }

  const handleToggleJoplinExportReasoning = (checked: boolean) => {
    void setJoplinExportReasoning(checked).catch(showSaveFailed)
  }

  const handleJoplinHelpClick = () => {
    void window.api.openWebsite('https://joplinapp.org/help/apps/clipper').catch((error) => {
      logger.error('Failed to open Joplin documentation', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('common.operation_failed')))
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.joplin.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.url')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={joplinUrl || ''}
            onChange={handleJoplinUrlChange}
            onBlur={handleJoplinUrlBlur}
            className="w-78.75 max-w-full"
            placeholder={t('settings.data.joplin.url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.joplin.token')}</span>
          <InfoTooltip
            content={t('settings.data.joplin.help')}
            placement="left"
            iconProps={{ className: 'text-text-2 cursor-pointer ml-1' }}
            onClick={handleJoplinHelpClick}
          />
        </SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <RowFlex className="w-full min-w-0 items-center gap-1.25">
            <Input
              type="password"
              value={joplinToken || ''}
              onChange={handleJoplinTokenChange}
              onBlur={handleJoplinTokenChange}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button
              onClick={handleJoplinConnectionCheck}
              variant="outline"
              className="h-9 shrink-0"
              disabled={checkingConnection}
              loading={checkingConnection}>
              {t('settings.data.joplin.check.button')}
            </Button>
          </RowFlex>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={joplinExportReasoning} onCheckedChange={handleToggleJoplinExportReasoning} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.joplin.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
