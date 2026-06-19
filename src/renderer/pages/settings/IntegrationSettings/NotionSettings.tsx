import { Button, InfoTooltip, Input, RowFlex, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { Client } from '@notionhq/client'
import { useTheme } from '@renderer/context/ThemeProvider'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('NotionSettings')

const NotionSettings: FC = () => {
  const [notionApiKey, setNotionApiKey] = usePreference('data.integration.notion.api_key')
  const [notionDatabaseID, setNotionDatabaseID] = usePreference('data.integration.notion.database_id')
  const [notionPageNameKey, setNotionPageNameKey] = usePreference('data.integration.notion.page_name_key')
  const [notionExportReasoning, setNotionExportReasoning] = usePreference('data.integration.notion.export_reasoning')

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

  const showSaveFailed = useCallback(
    (error: unknown) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
    },
    [t]
  )

  const handleNotionTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setNotionApiKey(e.target.value).catch(showSaveFailed)
  }

  const handleNotionDatabaseIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setNotionDatabaseID(e.target.value).catch(showSaveFailed)
  }

  const handleNotionPageNameKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setNotionPageNameKey(e.target.value).catch(showSaveFailed)
  }

  const handleNotionConnectionCheck = async () => {
    if (checkingConnectionRef.current) {
      return
    }
    try {
      if (!notionApiKey?.trim()) {
        window.toast.error(t('settings.data.notion.check.empty_api_key'))
        return
      }
      if (!notionDatabaseID?.trim()) {
        window.toast.error(t('settings.data.notion.check.empty_database_id'))
        return
      }

      checkingConnectionRef.current = true
      setCheckingConnection(true)
      const notion = new Client({ auth: notionApiKey })
      const result = await notion.databases.retrieve({
        database_id: notionDatabaseID
      })

      if (!mountedRef.current) {
        return
      }

      if (result) {
        window.toast.success(t('settings.data.notion.check.success'))
      } else {
        window.toast.error(t('settings.data.notion.check.fail'))
      }
    } catch (error) {
      logger.error('Failed to check Notion connection', error as Error)
      if (mountedRef.current) {
        window.toast.error(formatErrorMessage(error) || t('settings.data.notion.check.error'))
      }
    } finally {
      checkingConnectionRef.current = false
      if (mountedRef.current) {
        setCheckingConnection(false)
      }
    }
  }

  const handleNotionExportReasoningChange = (checked: boolean) => {
    void setNotionExportReasoning(checked).catch(showSaveFailed)
  }

  const handleNotionTitleClick = () => {
    void window.api.openWebsite('https://docs.cherry-ai.com/advanced-basic/notion').catch((error) => {
      logger.error('Failed to open Notion documentation', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('common.operation_failed')))
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ justifyContent: 'flex-start', gap: 10 }}>
        {t('settings.data.notion.title')}
        <InfoTooltip
          content={t('settings.data.notion.help')}
          placement="right"
          iconProps={{ className: 'text-text-2 cursor-pointer' }}
          onClick={handleNotionTitleClick}
        />
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.database_id')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={notionDatabaseID || ''}
            onChange={handleNotionDatabaseIdChange}
            onBlur={handleNotionDatabaseIdChange}
            placeholder={t('settings.data.notion.database_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.page_name_key')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <Input
            type="text"
            value={notionPageNameKey || ''}
            onChange={handleNotionPageNameKeyChange}
            onBlur={handleNotionPageNameKeyChange}
            placeholder={t('settings.data.notion.page_name_key_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.api_key')}</SettingRowTitle>
        <RowFlex className="w-78.75 min-w-0 max-w-full items-center gap-1.25">
          <RowFlex className="w-full min-w-0 items-center gap-1.25">
            <Input
              type="password"
              value={notionApiKey || ''}
              onChange={handleNotionTokenChange}
              onBlur={handleNotionTokenChange}
              placeholder={t('settings.data.notion.api_key_placeholder')}
              style={{ width: '100%' }}
            />
            <Button
              onClick={handleNotionConnectionCheck}
              variant="outline"
              className="h-9 shrink-0"
              disabled={checkingConnection}
              loading={checkingConnection}>
              {t('settings.data.notion.check.button')}
            </Button>
          </RowFlex>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.notion.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={notionExportReasoning} onCheckedChange={handleNotionExportReasoningChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.notion.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default NotionSettings
