import { DeleteOutlined, FolderOpenOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons'
import { Button, Input, RowFlex, Switch, WarnTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { LocalBackupManager } from '@renderer/components/LocalBackupManager'
import { LocalBackupModal, useLocalBackupModal } from '@renderer/components/LocalBackupModals'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppSelector } from '@renderer/store'
import type { AppInfo } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
const logger = loggerService.withContext('LocalBackupSettings')

const LocalBackupSettings: React.FC = () => {
  const [, setLocalBackupAutoSync] = usePreference('data.backup.local.auto_sync')
  const [localBackupDir, setLocalBackupDir] = usePreference('data.backup.local.dir')
  const [localBackupMaxBackups, setLocalBackupMaxBackups] = usePreference('data.backup.local.max_backups')
  const [localBackupSkipBackupFile, setLocalBackupSkipBackupFile] = usePreference('data.backup.local.skip_backup_file')
  const [localBackupSyncInterval, setLocalBackupSyncInterval] = usePreference('data.backup.local.sync_interval')

  const [resolvedLocalBackupDir, setResolvedLocalBackupDir] = useState<string | undefined>(undefined)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const [appInfo, setAppInfo] = useState<AppInfo>()
  const mountedRef = useRef(true)
  const directoryChangeSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      directoryChangeSeqRef.current += 1
    }
  }, [])

  const isDirectoryChangeCurrent = useCallback(
    (requestSeq: number) => mountedRef.current && requestSeq === directoryChangeSeqRef.current,
    []
  )

  useEffect(() => {
    let cancelled = false
    void window.api
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch((error) => {
        logger.warn('Failed to read app info for local backup settings', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!localBackupDir) {
      setResolvedLocalBackupDir(undefined)
      return
    }
    void window.api
      .resolvePath(localBackupDir)
      .then((resolvedDir) => {
        if (!cancelled) setResolvedLocalBackupDir(resolvedDir)
      })
      .catch((error) => {
        logger.warn('Failed to resolve local backup directory', error as Error, { localBackupDir })
        if (!cancelled) setResolvedLocalBackupDir(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [localBackupDir])

  const { theme } = useTheme()

  const { t } = useTranslation()

  const { localBackupSync } = useAppSelector((state) => state.backup)

  const showSaveFailed = (error: unknown) => {
    window.toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
  }

  const onSyncIntervalChange = async (value: number) => {
    try {
      await setLocalBackupSyncInterval(value)
      if (value === 0) {
        await setLocalBackupAutoSync(false)
        stopAutoSync('local')
      } else {
        await setLocalBackupAutoSync(true)
        startAutoSync(false, 'local')
      }
    } catch (error) {
      showSaveFailed(error)
    }
  }

  const checkLocalBackupDirValid = async (dir: string, requestSeq: number) => {
    if (dir === '') {
      return false
    }

    const info = appInfo ?? (await window.api.getAppInfo())
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return false
    }

    if (!appInfo) {
      setAppInfo(info)
    }

    const resolvedDir = await window.api.resolvePath(dir)
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return false
    }

    // check new local backup dir is not in app data path
    // if is in app data path, show error
    const isInAppDataPath = await window.api.isPathInside(resolvedDir, info.appDataPath)
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return false
    }
    if (isInAppDataPath) {
      window.toast.error(t('settings.data.local.directory.select_error_app_data_path'))
      return false
    }

    // check new local backup dir is not in app install path
    // if is in app install path, show error
    const isInInstallPath = await window.api.isPathInside(resolvedDir, info.installPath)
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return false
    }
    if (isInInstallPath) {
      window.toast.error(t('settings.data.local.directory.select_error_in_app_install_path'))
      return false
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(resolvedDir)
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return false
    }
    if (!hasWritePermission) {
      window.toast.error(t('settings.data.local.directory.select_error_write_permission'))
      return false
    }

    return true
  }

  const clearLocalBackupDirectory = async (requestSeq: number) => {
    await setLocalBackupDir('')
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return
    }

    await setLocalBackupAutoSync(false)
    if (!isDirectoryChangeCurrent(requestSeq)) {
      return
    }

    stopAutoSync('local')
  }

  const handleLocalBackupDirChange = async (value: string, requestSeq = ++directoryChangeSeqRef.current) => {
    try {
      if (value === localBackupDir) {
        return
      }

      if (value === '') {
        await clearLocalBackupDirectory(requestSeq)
        return
      }

      if (await checkLocalBackupDirValid(value, requestSeq)) {
        if (!isDirectoryChangeCurrent(requestSeq)) {
          return
        }

        await setLocalBackupDir(value)
        if (!isDirectoryChangeCurrent(requestSeq)) {
          return
        }

        const resolvedDir = await window.api.resolvePath(value)
        if (!isDirectoryChangeCurrent(requestSeq)) {
          return
        }
        setResolvedLocalBackupDir(resolvedDir)

        await setLocalBackupAutoSync(true)
        if (!isDirectoryChangeCurrent(requestSeq)) {
          return
        }

        startAutoSync(true, 'local')
        return
      }

      if (localBackupDir && isDirectoryChangeCurrent(requestSeq)) {
        await setLocalBackupDir(localBackupDir)
        return
      }
    } catch (error) {
      logger.error('Failed to change local backup directory:', error as Error)
      if (isDirectoryChangeCurrent(requestSeq)) {
        window.toast.error(t('settings.data.app_data.select_error'))
      }
    }
  }

  const onMaxBackupsChange = (value: number) => {
    void setLocalBackupMaxBackups(value).catch(showSaveFailed)
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    void setLocalBackupSkipBackupFile(value).catch(showSaveFailed)
  }

  const handleBrowseDirectory = async () => {
    const requestSeq = ++directoryChangeSeqRef.current

    try {
      const newLocalBackupDir = await window.api.select({
        properties: ['openDirectory', 'createDirectory'],
        title: t('settings.data.local.directory.select_title')
      })

      if (!isDirectoryChangeCurrent(requestSeq) || !newLocalBackupDir) {
        return
      }

      await handleLocalBackupDirChange(newLocalBackupDir, requestSeq)
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
    }
  }

  const handleClearDirectory = async () => {
    const requestSeq = ++directoryChangeSeqRef.current
    await clearLocalBackupDirectory(requestSeq)
  }

  const renderSyncStatus = () => {
    if (!localBackupDir) return null

    if (!localBackupSync.lastSyncTime && !localBackupSync.syncing && !localBackupSync.lastSyncError) {
      return <span style={{ color: 'var(--color-foreground-secondary)' }}>{t('settings.data.local.noSync')}</span>
    }

    return (
      <RowFlex className="items-center gap-1.25">
        {localBackupSync.syncing && <SyncOutlined spin />}
        {!localBackupSync.syncing && localBackupSync.lastSyncError && (
          <WarnTooltip
            content={`${t('settings.data.local.syncError')}: ${localBackupSync.lastSyncError}`}
            iconProps={{ style: { color: 'red' } }}
          />
        )}
        {localBackupSync.lastSyncTime && (
          <span style={{ color: 'var(--color-foreground-secondary)' }}>
            {t('settings.data.local.lastSync')}: {dayjs(localBackupSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </RowFlex>
    )
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useLocalBackupModal(resolvedLocalBackupDir)

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.local.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.directory.label')}</SettingRowTitle>
        <RowFlex className="gap-1.25">
          <Input
            value={localBackupDir}
            onChange={(e) => setLocalBackupDir(e.target.value)}
            onBlur={(e) => handleLocalBackupDirChange(e.target.value)}
            placeholder={t('settings.data.local.directory.placeholder')}
            style={{ minWidth: 200, maxWidth: 400, flex: 1 }}
          />
          <Button onClick={handleBrowseDirectory} variant="outline">
            <FolderOpenOutlined />
            {t('common.browse')}
          </Button>
          <Button onClick={handleClearDirectory} disabled={!localBackupDir} variant="destructive">
            <DeleteOutlined />
            {t('common.clear')}
          </Button>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <RowFlex className="justify-between gap-1.25">
          <Button onClick={showBackupModal} disabled={!localBackupDir || backuping} variant="outline">
            <SaveOutlined />
            {t('settings.data.local.backup.button')}
          </Button>
          <Button onClick={showBackupManager} disabled={!localBackupDir} variant="outline">
            <FolderOpenOutlined />
            {t('settings.data.local.restore.button')}
          </Button>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.autoSync.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={localBackupSyncInterval}
          onChange={onSyncIntervalChange}
          disabled={!localBackupDir}
          options={[
            { label: t('settings.data.local.autoSync.off'), value: 0 },
            { label: t('settings.data.local.minute_interval', { count: 1 }), value: 1 },
            { label: t('settings.data.local.minute_interval', { count: 5 }), value: 5 },
            { label: t('settings.data.local.minute_interval', { count: 15 }), value: 15 },
            { label: t('settings.data.local.minute_interval', { count: 30 }), value: 30 },
            { label: t('settings.data.local.hour_interval', { count: 1 }), value: 60 },
            { label: t('settings.data.local.hour_interval', { count: 2 }), value: 120 },
            { label: t('settings.data.local.hour_interval', { count: 6 }), value: 360 },
            { label: t('settings.data.local.hour_interval', { count: 12 }), value: 720 },
            { label: t('settings.data.local.hour_interval', { count: 24 }), value: 1440 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.maxBackups.label')}</SettingRowTitle>
        <Selector
          size={14}
          value={localBackupMaxBackups}
          onChange={onMaxBackupsChange}
          disabled={!localBackupDir}
          options={[
            { label: t('settings.data.local.maxBackups.unlimited'), value: 0 },
            { label: '1', value: 1 },
            { label: '3', value: 3 },
            { label: '5', value: 5 },
            { label: '10', value: 10 },
            { label: '20', value: 20 },
            { label: '50', value: 50 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
        <Switch checked={localBackupSkipBackupFile} onCheckedChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
      </SettingRow>
      {localBackupSync && localBackupSyncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.local.syncStatus')}</SettingRowTitle>
            {renderSyncStatus()}
          </SettingRow>
        </>
      )}
      <>
        <LocalBackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <LocalBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          localBackupDir={resolvedLocalBackupDir}
        />
      </>
    </SettingGroup>
  )
}

export default LocalBackupSettings
