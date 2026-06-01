import { FolderOpenOutlined, HomeOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { startDataSyncAutoSync, stopDataSyncAutoSync, syncAppDataNow } from '@renderer/services/DataSyncService'
import { reportErrorToSystemAgent } from '@renderer/services/SystemAgentService'
import { useAppDispatch } from '@renderer/store'
import {
  setDataSyncAutoSync,
  setDataSyncSyncInterval,
  setDataSyncWebdavHost,
  setDataSyncWebdavPass,
  setDataSyncWebdavPath,
  setDataSyncWebdavUser
} from '@renderer/store/settings'
import { Alert, Breadcrumb, Button, Empty, Input, List, Modal, Space, Spin, Typography } from 'antd'
import dayjs from 'dayjs'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

type SyncSummary = {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  skipped: number
  storageUploaded?: number
  storageDownloaded?: number
  storageDeleted?: number
  storageConflicts?: number
  storageSkipped?: number
  blobUploaded?: number
  blobDownloaded?: number
  snapshotUploaded?: boolean
  snapshotFileName?: string | null
  snapshotBytes?: number
  lastSyncAt: number
}

type SyncStatus = {
  deviceId: string
  lastSummary: SyncSummary
  conflicts: unknown[]
}

type RemoteDirectory = {
  name: string
  path: string
  modifiedAt: string | null
}

type RemoteDirectoryList = {
  path: string
  parentPath: string | null
  directories: RemoteDirectory[]
}

const DEFAULT_REMOTE_PATH = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function normalizeWebdavHostInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function normalizeRemotePathInput(value?: string) {
  const trimmed = value?.trim() || DEFAULT_REMOTE_PATH
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/$/g, '')
  }
  if (normalized === DATA_SYNC_SUFFIX || normalized.endsWith(DATA_SYNC_SUFFIX)) {
    normalized = normalized.slice(0, -DATA_SYNC_SUFFIX.length) || '/'
  }
  return normalized
}

function normalizeDirectoryBrowserPath(value?: string) {
  const trimmed = value?.trim() || '/'
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/$/g, '')
  }
  return normalized
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function makeBreadcrumbItems(currentPath: string, onOpen: (path: string) => void) {
  const normalized = normalizeDirectoryBrowserPath(currentPath || '/')
  const parts = normalized.split('/').filter(Boolean)
  const items = [
    {
      title: <HomeOutlined onClick={() => onOpen('/')} style={{ cursor: 'pointer' }} />
    }
  ]

  let cursor = ''
  parts.forEach((part, index) => {
    cursor = `${cursor}/${part}`
    const itemPath = cursor
    const isLast = index === parts.length - 1
    items.push({
      title: isLast ? <span>{part}</span> : <Typography.Link onClick={() => onOpen(itemPath)}>{part}</Typography.Link>
    })
  })

  return items
}

const DataSyncSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { dataSyncWebdavHost, dataSyncWebdavUser, dataSyncWebdavPass, dataSyncWebdavPath, dataSyncSyncInterval } =
    useSettings()
  const dispatch = useAppDispatch()
  const [webdavHost, setWebdavHost] = useState(dataSyncWebdavHost)
  const [webdavUser, setWebdavUser] = useState(dataSyncWebdavUser)
  const [webdavPass, setWebdavPass] = useState(dataSyncWebdavPass)
  const [webdavPath, setWebdavPath] = useState(dataSyncWebdavPath)
  const [syncInterval, setSyncInterval] = useState(dataSyncSyncInterval)
  const [syncing, setSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [remoteDirectoryList, setRemoteDirectoryList] = useState<RemoteDirectoryList | null>(null)

  const saveWebDavConfig = (nextPath = webdavPath) => {
    const normalizedHost = normalizeWebdavHostInput(webdavHost)
    const normalizedPath = normalizeRemotePathInput(nextPath)

    setWebdavHost(normalizedHost)
    setWebdavPath(normalizedPath)
    dispatch(setDataSyncWebdavHost(normalizedHost))
    dispatch(setDataSyncWebdavUser(webdavUser || ''))
    dispatch(setDataSyncWebdavPass(webdavPass || ''))
    dispatch(setDataSyncWebdavPath(normalizedPath))

    return {
      webdavHost: normalizedHost,
      webdavUser,
      webdavPass,
      webdavPath: normalizedPath
    }
  }

  const refreshStatus = async () => {
    const nextStatus = await window.api.dataSync.getStatus()
    setStatus(nextStatus)
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  const syncNow = async () => {
    if (!webdavHost) {
      window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
      return
    }

    const config = saveWebDavConfig()

    setSyncing(true)
    try {
      const summary = await syncAppDataNow(config)
      if (summary) {
        setStatus((prev) => ({
          deviceId: prev?.deviceId || '',
          conflicts: prev?.conflicts || [],
          lastSummary: summary
        }))
      }
      await refreshStatus()
      window.toast.success(t('settings.data.data_sync.toast.sync_success'))
    } catch (error) {
      window.toast.error(t('settings.data.data_sync.toast.sync_failed', { message: getErrorMessage(error) }))
      void reportErrorToSystemAgent(
        error,
        {
          source: 'settings.data_sync.sync_now',
          domain: 'dataSync',
          details: {
            webdavHost,
            webdavPath: normalizeRemotePathInput(webdavPath)
          }
        },
        { showToast: true }
      )
    } finally {
      setSyncing(false)
    }
  }

  const restoreLatestSnapshot = () => {
    if (!webdavHost) {
      window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
      return
    }

    const config = saveWebDavConfig()

    Modal.confirm({
      title: t('settings.data.data_sync.restore_confirm_title'),
      content: t('settings.data.data_sync.restore_confirm_content'),
      okText: t('settings.data.data_sync.restore_latest'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setRestoring(true)
        try {
          await window.api.dataSync.restoreLatestSnapshot(config)
          window.toast.success(t('settings.data.data_sync.toast.restore_success'))
        } catch (error) {
          window.toast.error(t('settings.data.data_sync.toast.restore_failed', { message: getErrorMessage(error) }))
          void reportErrorToSystemAgent(
            error,
            {
              source: 'settings.data_sync.restore_latest_snapshot',
              domain: 'dataSync',
              details: {
                webdavHost,
                webdavPath: normalizeRemotePathInput(webdavPath)
              }
            },
            { showToast: true }
          )
        } finally {
          setRestoring(false)
        }
      }
    })
  }

  const summary = status?.lastSummary

  const loadRemoteDirectories = async (path: string) => {
    const normalizedHost = normalizeWebdavHostInput(webdavHost)
    if (!normalizedHost) {
      window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
      return
    }

    setDirectoryLoading(true)
    setDirectoryError(null)
    try {
      const result = await window.api.dataSync.listRemoteDirectories(
        {
          webdavHost: normalizedHost,
          webdavUser,
          webdavPass,
          webdavPath: normalizeRemotePathInput(webdavPath)
        },
        path
      )
      setRemoteDirectoryList(result)
    } catch (error) {
      setDirectoryError(getErrorMessage(error))
      void reportErrorToSystemAgent(
        error,
        {
          source: 'settings.data_sync.remote_directory_browser',
          domain: 'dataSync',
          details: {
            remotePath: path,
            webdavHost,
            webdavPath: normalizeRemotePathInput(webdavPath)
          }
        },
        { showToast: true }
      )
    } finally {
      setDirectoryLoading(false)
    }
  }

  const openDirectoryBrowser = () => {
    if (!webdavHost) {
      window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
      return
    }

    const normalizedConfig = saveWebDavConfig()
    setDirectoryBrowserOpen(true)
    void loadRemoteDirectories(
      normalizedConfig.webdavPath === DEFAULT_REMOTE_PATH ? '/' : normalizedConfig.webdavPath || '/'
    )
  }

  const selectRemotePath = (path: string) => {
    saveWebDavConfig(path)
    setDirectoryBrowserOpen(false)
    window.toast.success(
      t('settings.data.data_sync.toast.remote_path_selected', { path: normalizeRemotePathInput(path) })
    )
  }

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    saveWebDavConfig()
    dispatch(setDataSyncSyncInterval(value))
    dispatch(setDataSyncAutoSync(value > 0))

    if (value > 0) {
      startDataSyncAutoSync(false)
    } else {
      stopDataSyncAutoSync()
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.data_sync.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.method')}</SettingRowTitle>
        <Typography.Text type="secondary">{t('settings.data.data_sync.method_value')}</Typography.Text>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.webdav_host')}</SettingRowTitle>
        <Input
          placeholder="https://example.com/dav"
          value={webdavHost}
          onChange={(event) => setWebdavHost(event.target.value)}
          onBlur={() => {
            const normalizedHost = normalizeWebdavHostInput(webdavHost)
            setWebdavHost(normalizedHost)
            dispatch(setDataSyncWebdavHost(normalizedHost))
            if (!normalizedHost) {
              setSyncInterval(0)
              dispatch(setDataSyncSyncInterval(0))
              dispatch(setDataSyncAutoSync(false))
              stopDataSyncAutoSync()
            }
          }}
          style={{ width: 280 }}
          type="url"
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.username')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.data_sync.username_placeholder')}
          value={webdavUser}
          onChange={(event) => setWebdavUser(event.target.value)}
          onBlur={() => dispatch(setDataSyncWebdavUser(webdavUser || ''))}
          style={{ width: 280 }}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.password')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.data_sync.password_placeholder')}
          value={webdavPass}
          onChange={(event) => setWebdavPass(event.target.value)}
          onBlur={() => dispatch(setDataSyncWebdavPass(webdavPass || ''))}
          style={{ width: 280 }}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.remote_path')}</SettingRowTitle>
        <HStack gap="8px">
          <Input
            readOnly
            placeholder={DEFAULT_REMOTE_PATH}
            value={normalizeRemotePathInput(webdavPath)}
            style={{ width: 280 }}
          />
          <Button icon={<FolderOpenOutlined />} disabled={!webdavHost} onClick={openDirectoryBrowser}>
            {t('settings.data.data_sync.remote_path_browse')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.auto_sync')}</SettingRowTitle>
        <Selector
          size={14}
          value={syncInterval}
          onChange={onSyncIntervalChange}
          disabled={!webdavHost}
          options={[
            { label: t('settings.data.data_sync.interval.off'), value: 0 },
            { label: t('settings.data.data_sync.interval.minute_one'), value: 1 },
            { label: t('settings.data.data_sync.interval.minute_other', { count: 5 }), value: 5 },
            { label: t('settings.data.data_sync.interval.minute_other', { count: 15 }), value: 15 },
            { label: t('settings.data.data_sync.interval.minute_other', { count: 30 }), value: 30 },
            { label: t('settings.data.data_sync.interval.hour_one'), value: 60 },
            { label: t('settings.data.data_sync.interval.hour_other', { count: 2 }), value: 120 },
            { label: t('settings.data.data_sync.interval.hour_other', { count: 6 }), value: 360 },
            { label: t('settings.data.data_sync.interval.hour_other', { count: 12 }), value: 720 },
            { label: t('settings.data.data_sync.interval.day_one'), value: 1440 }
          ]}
        />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.data_sync.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.current_device')}</SettingRowTitle>
        <Typography.Text type="secondary" copyable>
          {status?.deviceId || t('settings.data.data_sync.uninitialized')}
        </Typography.Text>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.sync_now')}</SettingRowTitle>
        <HStack gap="8px">
          <Button
            type="primary"
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            disabled={!webdavHost || restoring}
            onClick={syncNow}>
            {t('settings.data.data_sync.sync')}
          </Button>
          <Button loading={restoring} disabled={!webdavHost || syncing} onClick={restoreLatestSnapshot}>
            {t('settings.data.data_sync.restore_latest')}
          </Button>
        </HStack>
      </SettingRow>
      {summary && summary.lastSyncAt > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.last_result')}</SettingRowTitle>
            <HStack gap="12px" style={{ flexWrap: 'wrap' }}>
              <Typography.Text type="secondary">
                {dayjs(summary.lastSyncAt).format('YYYY-MM-DD HH:mm:ss')}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.data.data_sync.summary.uploaded', { count: summary.uploaded })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.data.data_sync.summary.downloaded', { count: summary.downloaded })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.data.data_sync.summary.deleted', { count: summary.deleted })}
              </Typography.Text>
              <Typography.Text type={summary.conflicts ? 'warning' : 'secondary'}>
                {t('settings.data.data_sync.summary.conflicts', { count: summary.conflicts })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.data.data_sync.storage.records', {
                  uploaded: summary.storageUploaded ?? 0,
                  downloaded: summary.storageDownloaded ?? 0
                })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.data.data_sync.storage.blobs', {
                  uploaded: summary.blobUploaded ?? 0,
                  downloaded: summary.blobDownloaded ?? 0
                })}
              </Typography.Text>
              <Typography.Text type={summary.storageConflicts ? 'warning' : 'secondary'}>
                {t('settings.data.data_sync.storage.conflicts', { count: summary.storageConflicts ?? 0 })}
              </Typography.Text>
              {summary.snapshotUploaded && (
                <Typography.Text type="secondary">
                  {t('settings.data.data_sync.snapshot.uploaded', {
                    file: summary.snapshotFileName || '-',
                    size: formatBytes(summary.snapshotBytes ?? 0)
                  })}
                </Typography.Text>
              )}
            </HStack>
          </SettingRow>
        </>
      )}
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.unresolved_conflicts')}</SettingRowTitle>
        <Typography.Text type={status?.conflicts?.length ? 'warning' : 'secondary'}>
          {status?.conflicts?.length || 0}
        </Typography.Text>
      </SettingRow>
      <Modal
        centered
        open={directoryBrowserOpen}
        title={t('settings.data.data_sync.remote_browser.title')}
        width={640}
        onCancel={() => setDirectoryBrowserOpen(false)}
        footer={
          <Space>
            <Button onClick={() => selectRemotePath(DEFAULT_REMOTE_PATH)}>
              {t('settings.data.data_sync.remote_browser.use_default')}
            </Button>
            <Button
              type="primary"
              disabled={!remoteDirectoryList?.path}
              onClick={() => selectRemotePath(remoteDirectoryList?.path || DEFAULT_REMOTE_PATH)}>
              {t('settings.data.data_sync.remote_browser.select_current')}
            </Button>
          </Space>
        }>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <HStack gap="8px" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Breadcrumb
              items={makeBreadcrumbItems(remoteDirectoryList?.path || '/', (path) => void loadRemoteDirectories(path))}
            />
            <Button
              icon={<ReloadOutlined spin={directoryLoading} />}
              onClick={() => void loadRemoteDirectories(remoteDirectoryList?.path || '/')}>
              {t('settings.data.data_sync.remote_browser.refresh')}
            </Button>
          </HStack>
          <Typography.Text type="secondary">
            {t('settings.data.data_sync.remote_browser.current_path', {
              path: remoteDirectoryList?.path || normalizeRemotePathInput(webdavPath)
            })}
          </Typography.Text>
          {directoryError && (
            <Alert
              showIcon
              type="warning"
              message={t('settings.data.data_sync.remote_browser.error_title')}
              description={directoryError}
            />
          )}
          <Spin spinning={directoryLoading}>
            {remoteDirectoryList?.directories?.length ? (
              <List
                size="small"
                dataSource={remoteDirectoryList.directories}
                renderItem={(directory) => (
                  <List.Item
                    actions={[
                      <Button key="select" type="link" onClick={() => selectRemotePath(directory.path)}>
                        {t('settings.data.data_sync.remote_browser.select')}
                      </Button>
                    ]}>
                    <List.Item.Meta
                      avatar={<FolderOpenOutlined />}
                      title={
                        <Typography.Link onClick={() => void loadRemoteDirectories(directory.path)}>
                          {directory.name}
                        </Typography.Link>
                      }
                      description={directory.path}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description={t('settings.data.data_sync.remote_browser.empty')} />
            )}
          </Spin>
        </Space>
      </Modal>
    </SettingGroup>
  )
}

export default DataSyncSettings
