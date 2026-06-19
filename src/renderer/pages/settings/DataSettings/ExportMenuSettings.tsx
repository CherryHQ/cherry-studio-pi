import { Switch } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
const ExportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const [exportMenuOptions, setExportMenuOptions] = useMultiplePreferences({
    image: 'data.export.menus.image',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notion: 'data.export.menus.notion',
    yuque: 'data.export.menus.yuque',
    joplin: 'data.export.menus.joplin',
    obsidian: 'data.export.menus.obsidian',
    siyuan: 'data.export.menus.siyuan',
    docx: 'data.export.menus.docx',
    plain_text: 'data.export.menus.plain_text'
  })

  const showSaveFailed = useCallback(
    (error: unknown) => {
      if (mountedRef.current) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
      }
    },
    [t]
  )

  const handleToggleOption = (option: string, checked: boolean) => {
    void setExportMenuOptions({
      [option]: checked
    }).catch(showSaveFailed)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.export_menu.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.image')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.image} onCheckedChange={(checked) => handleToggleOption('image', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.markdown}
          onCheckedChange={(checked) => handleToggleOption('markdown', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown_reason')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.markdown_reason}
          onCheckedChange={(checked) => handleToggleOption('markdown_reason', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.notion')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.notion}
          onCheckedChange={(checked) => handleToggleOption('notion', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.yuque')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.yuque} onCheckedChange={(checked) => handleToggleOption('yuque', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.joplin')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.joplin}
          onCheckedChange={(checked) => handleToggleOption('joplin', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.obsidian')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.obsidian}
          onCheckedChange={(checked) => handleToggleOption('obsidian', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.siyuan')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.siyuan}
          onCheckedChange={(checked) => handleToggleOption('siyuan', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.docx')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.docx} onCheckedChange={(checked) => handleToggleOption('docx', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.plain_text')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.plain_text}
          onCheckedChange={(checked) => handleToggleOption('plain_text', checked)}
        />
      </SettingRow>
    </SettingGroup>
  )
}

export default ExportMenuOptions
