import {
  EmptyState,
  RowFlex,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('ObsidianSettings')

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()

  const [defaultObsidianVault, setDefaultObsidianVault] = usePreference('data.integration.obsidian.default_vault')

  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const defaultObsidianVaultRef = useRef(defaultObsidianVault)
  const vaultRequestSeqRef = useRef(0)

  useEffect(() => {
    defaultObsidianVaultRef.current = defaultObsidianVault
  }, [defaultObsidianVault])

  const showSaveFailed = useCallback(
    (error: unknown) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
    },
    [t]
  )

  useEffect(() => {
    let isActive = true
    const requestSeq = ++vaultRequestSeqRef.current

    const fetchVaults = async () => {
      try {
        setLoading(true)
        setError(null)
        const vaultsData = await window.api.obsidian.getVaults()

        if (!isActive || requestSeq !== vaultRequestSeqRef.current) {
          return
        }

        if (vaultsData.length === 0) {
          setVaults([])
          setError(t('settings.data.obsidian.default_vault_no_vaults'))
          return
        }

        setVaults(vaultsData)

        if (!defaultObsidianVaultRef.current && vaultsData.length > 0) {
          void setDefaultObsidianVault(vaultsData[0].name).catch(showSaveFailed)
        }
      } catch (error) {
        if (isActive && requestSeq === vaultRequestSeqRef.current) {
          logger.error('Failed to fetch Obsidian vaults', error as Error)
          setError(t('settings.data.obsidian.default_vault_fetch_error'))
        }
      } finally {
        if (isActive && requestSeq === vaultRequestSeqRef.current) {
          setLoading(false)
        }
      }
    }

    void fetchVaults()

    return () => {
      isActive = false
      vaultRequestSeqRef.current += 1
    }
  }, [setDefaultObsidianVault, showSaveFailed, t])

  const handleChange = (value: string) => {
    void setDefaultObsidianVault(value).catch(showSaveFailed)
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.default_vault')}</SettingRowTitle>
        <RowFlex className="gap-1.25">
          {loading ? (
            <Spinner text={t('common.loading')} />
          ) : vaults.length > 0 ? (
            <Select value={defaultObsidianVault || undefined} onValueChange={handleChange}>
              <SelectTrigger className="w-75 max-w-full">
                <SelectValue placeholder={t('settings.data.obsidian.default_vault_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {vaults.map((vault) => (
                  <SelectItem key={vault.name} value={vault.name}>
                    {vault.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <EmptyState
              compact
              preset="no-resource"
              description={error || t('settings.data.obsidian.default_vault_no_vaults')}
            />
          )}
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
