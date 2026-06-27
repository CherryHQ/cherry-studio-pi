import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RowFlex,
  Spinner
} from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  type DataSyncRuntimeState,
  type DataSyncStatus,
  readDataSyncSettings,
  refreshDataSyncRuntimeStateFromMain,
  startDataSyncAutoSync,
  stopDataSyncAutoSync,
  subscribeDataSyncRuntimeState,
  syncAppDataNow,
  writeDataSyncSettings
} from '@renderer/services/DataSyncService'
import { normalizeWebDavConfig, normalizeWebDavHost, normalizeWebDavPath, parseWebDavInput } from '@shared/webdavConfig'
import dayjs from 'dayjs'
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Home,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { ClipboardEvent, FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

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

type DiagnosisState = {
  ok: boolean
  summary: string
  checkedAt: number
  remotePath?: string
  deviceId?: string
}

const DEFAULT_REMOTE_PATH = '/cherry-studio-pi'
const DATA_SYNC_SUFFIX = '/sync/v1'

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'Unknown error'
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function normalizeRemotePathInput(value?: string) {
  let normalized = normalizeWebDavPath(value, DEFAULT_REMOTE_PATH)
  if (normalized === DATA_SYNC_SUFFIX || normalized.endsWith(DATA_SYNC_SUFFIX)) {
    normalized = normalized.slice(0, -DATA_SYNC_SUFFIX.length) || '/'
  }
  return normalized
}

function getEffectiveSyncPath(value?: string) {
  const basePath = normalizeRemotePathInput(value)
  return basePath === '/' ? DATA_SYNC_SUFFIX : `${basePath}${DATA_SYNC_SUFFIX}`
}

function getDirectoryBrowserStartPath(value?: string) {
  const remotePath = normalizeRemotePathInput(value)
  if (remotePath === '/' || remotePath === DEFAULT_REMOTE_PATH) return '/'
  return remotePath
}

function summaryCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readClipboardText(clipboardData: DataTransfer) {
  return clipboardData.getData('text/plain') || clipboardData.getData('text') || clipboardData.getData('Text')
}

const intervalOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
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
]

const DataSyncSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [webdavHost, setWebdavHost] = useState('')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')
  const [webdavPath, setWebdavPath] = useState(DEFAULT_REMOTE_PATH)
  const [syncInterval, setSyncInterval] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [runtimeSyncing, setRuntimeSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisState | null>(null)
  const [status, setStatus] = useState<DataSyncStatus | null>(null)
  const [statusRefreshing, setStatusRefreshing] = useState(false)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [remoteDirectoryList, setRemoteDirectoryList] = useState<RemoteDirectoryList | null>(null)
  const mountedRef = useRef(true)

  const currentConfig = useMemo(
    () => ({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath
    }),
    [webdavHost, webdavUser, webdavPass, webdavPath]
  )

  const updateFieldsFromSettings = useCallback((settings: Awaited<ReturnType<typeof readDataSyncSettings>>) => {
    setWebdavHost(settings.webdavHost)
    setWebdavUser(settings.webdavUser)
    setWebdavPass(settings.webdavPass)
    setWebdavPath(settings.webdavPath || DEFAULT_REMOTE_PATH)
    setSyncInterval(settings.syncInterval)
  }, [])

  const refreshStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setStatusRefreshing(true)
    try {
      const nextStatus = (await window.api.dataSync.getStatus()) as DataSyncStatus
      if (mountedRef.current) {
        setStatus(nextStatus)
        setRuntimeSyncing(Boolean(nextStatus?.syncing))
      }
      return nextStatus
    } catch (error) {
      window.toast.error(getErrorMessage(error))
      return null
    } finally {
      if (mountedRef.current) setStatusRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void readDataSyncSettings()
      .then((settings) => {
        if (!mountedRef.current) return
        updateFieldsFromSettings(settings)
      })
      .catch((error) => {
        window.toast.error(getErrorMessage(error))
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })

    void refreshStatus()

    const unsubscribeRuntimeState = subscribeDataSyncRuntimeState((state: DataSyncRuntimeState) => {
      if (!mountedRef.current) return
      setRuntimeSyncing(state.syncing)
    })
    const externalListener = () => {
      void refreshStatus()
    }
    window.addEventListener('cherry-studio-pi:data-sync-external-completed', externalListener)

    void refreshDataSyncRuntimeStateFromMain().catch(() => undefined)

    return () => {
      mountedRef.current = false
      unsubscribeRuntimeState()
      window.removeEventListener('cherry-studio-pi:data-sync-external-completed', externalListener)
    }
  }, [refreshStatus, updateFieldsFromSettings])

  const applyStructuredWebDavInput = useCallback((value: string) => {
    const parsed = parseWebDavInput(value)
    if (!parsed.structured) return false

    if (parsed.webdavHost) setWebdavHost(normalizeWebDavHost(parsed.webdavHost))
    if (parsed.webdavUser) setWebdavUser(parsed.webdavUser)
    if (parsed.webdavPass) setWebdavPass(parsed.webdavPass)
    if (parsed.webdavPath) setWebdavPath(normalizeRemotePathInput(parsed.webdavPath))
    return true
  }, [])

  const handleWebDavHostPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const text = readClipboardText(event.clipboardData)
      if (!text || !applyStructuredWebDavInput(text)) return
      event.preventDefault()
    },
    [applyStructuredWebDavInput]
  )

  const buildCurrentConfig = useCallback(
    (requireCredentials: boolean) => {
      if (!currentConfig.webdavHost.trim()) {
        throw new Error(t('settings.data.data_sync.toast.webdav_required'))
      }

      return normalizeWebDavConfig(currentConfig, {
        defaultPath: DEFAULT_REMOTE_PATH,
        requireCredentials
      })
    },
    [currentConfig, t]
  )

  const saveConfig = useCallback(
    async (next?: Partial<typeof currentConfig> & { syncInterval?: number }) => {
      const nextConfig = {
        ...currentConfig,
        ...next
      }
      setSaving(true)
      try {
        const normalized = nextConfig.webdavHost.trim()
          ? normalizeWebDavConfig(nextConfig, { defaultPath: DEFAULT_REMOTE_PATH, requireCredentials: false })
          : {
              ...nextConfig,
              webdavHost: '',
              webdavUser: nextConfig.webdavUser.trim(),
              webdavPath: normalizeRemotePathInput(nextConfig.webdavPath)
            }
        const saved = await writeDataSyncSettings({
          webdavHost: normalized.webdavHost,
          webdavUser: normalized.webdavUser,
          webdavPass: normalized.webdavPass,
          webdavPath: normalized.webdavPath,
          autoSync: (next?.syncInterval ?? syncInterval) > 0,
          syncInterval: next?.syncInterval ?? syncInterval
        })
        if (mountedRef.current) updateFieldsFromSettings(saved)
        return saved
      } finally {
        if (mountedRef.current) setSaving(false)
      }
    },
    [currentConfig, syncInterval, updateFieldsFromSettings]
  )

  const handleSave = async () => {
    try {
      await saveConfig()
      window.toast.success(t('common.saved'))
    } catch (error) {
      window.toast.error(getErrorMessage(error))
    }
  }

  const handleSyncIntervalChange = async (value: number) => {
    setSyncInterval(value)
    try {
      await saveConfig({ syncInterval: value })
      if (value > 0) {
        void startDataSyncAutoSync(true)
      } else {
        stopDataSyncAutoSync()
      }
    } catch (error) {
      window.toast.error(getErrorMessage(error))
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const config = buildCurrentConfig(true)
      await saveConfig(config)
      const summary = await syncAppDataNow(config)
      await refreshStatus()
      window.toast.success(
        summary ? t('settings.data.data_sync.toast.sync_success') : t('settings.data.data_sync.toast.sync_running')
      )
    } catch (error) {
      window.toast.error(t('settings.data.data_sync.toast.sync_failed', { message: getErrorMessage(error) }))
    } finally {
      if (mountedRef.current) setSyncing(false)
    }
  }

  const handleDiagnose = async () => {
    setDiagnosing(true)
    try {
      const config = buildCurrentConfig(true)
      await saveConfig(config)
      const [nextStatus, writeAccess] = await Promise.all([
        window.api.dataSync.getStatus() as Promise<DataSyncStatus>,
        window.api.dataSync.checkWriteAccess(config) as Promise<{ ok: boolean; basePath?: string }>
      ])
      setStatus(nextStatus)
      setDiagnosis({
        ok: writeAccess.ok,
        checkedAt: Date.now(),
        deviceId: nextStatus.deviceId,
        remotePath: writeAccess.basePath,
        summary: t('settings.data.data_sync.diagnosis.write_success')
      })
      window.toast.success(t('settings.data.data_sync.toast.diagnose_success'))
    } catch (error) {
      const message = getErrorMessage(error)
      setDiagnosis({
        ok: false,
        checkedAt: Date.now(),
        summary: message
      })
      window.toast.error(t('settings.data.data_sync.toast.diagnose_failed', { message }))
    } finally {
      if (mountedRef.current) setDiagnosing(false)
    }
  }

  const loadRemoteDirectories = useCallback(
    async (path: string) => {
      setDirectoryLoading(true)
      setDirectoryError(null)
      try {
        const config = buildCurrentConfig(true)
        const list = (await window.api.dataSync.listRemoteDirectories(config, path)) as RemoteDirectoryList
        if (!mountedRef.current) return
        setRemoteDirectoryList(list)
      } catch (error) {
        const message = getErrorMessage(error)
        if (mountedRef.current) setDirectoryError(message)
      } finally {
        if (mountedRef.current) setDirectoryLoading(false)
      }
    },
    [buildCurrentConfig]
  )

  const openDirectoryBrowser = async () => {
    try {
      await saveConfig()
      setDirectoryBrowserOpen(true)
      void loadRemoteDirectories(getDirectoryBrowserStartPath(webdavPath))
    } catch (error) {
      window.toast.error(getErrorMessage(error))
    }
  }

  const selectRemoteDirectory = async (path: string) => {
    const normalizedPath = normalizeRemotePathInput(path)
    setWebdavPath(normalizedPath)
    try {
      await saveConfig({ webdavPath: normalizedPath })
      window.toast.success(t('settings.data.data_sync.toast.remote_path_selected', { path: normalizedPath }))
      setDirectoryBrowserOpen(false)
    } catch (error) {
      window.toast.error(getErrorMessage(error))
    }
  }

  const handleRestoreLatest = async () => {
    try {
      const config = buildCurrentConfig(true)
      await saveConfig(config)
      window.modal.confirm({
        title: t('settings.data.data_sync.restore_confirm_title'),
        content: t('settings.data.data_sync.restore_confirm_content'),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        centered: true,
        icon: <AlertTriangle />,
        onOk: async () => {
          setRestoring(true)
          try {
            await window.api.dataSync.restoreLatestSnapshot(config)
            await refreshStatus()
            window.toast.success(t('settings.data.data_sync.toast.restore_success'))
          } catch (error) {
            window.toast.error(t('settings.data.data_sync.toast.restore_failed', { message: getErrorMessage(error) }))
          } finally {
            if (mountedRef.current) setRestoring(false)
          }
        }
      })
    } catch (error) {
      window.toast.error(getErrorMessage(error))
    }
  }

  const openJoinSafetySnapshot = async (filePath: string) => {
    try {
      await window.api.file.showInFolder(filePath)
    } catch (error) {
      window.toast.error(t('settings.data.data_sync.toast.open_snapshot_failed', { message: getErrorMessage(error) }))
    }
  }

  const summary = status?.lastSummary
  const isBusy = syncing || runtimeSyncing || restoring || diagnosing || saving
  const lastResultItems = summary
    ? [
        t('settings.data.data_sync.summary.uploaded', {
          count:
            summaryCount(summary.uploaded) + summaryCount(summary.storageUploaded) + summaryCount(summary.blobUploaded)
        }),
        t('settings.data.data_sync.summary.downloaded', {
          count:
            summaryCount(summary.downloaded) +
            summaryCount(summary.storageDownloaded) +
            summaryCount(summary.blobDownloaded)
        }),
        t('settings.data.data_sync.summary.deleted', {
          count: summaryCount(summary.deleted) + summaryCount(summary.storageDeleted)
        }),
        t('settings.data.data_sync.summary.conflicts', {
          count: summaryCount(summary.conflicts) + summaryCount(summary.storageConflicts)
        }),
        t('settings.data.data_sync.summary.resolved_conflicts', {
          count: summaryCount(summary.resolvedConflicts) + summaryCount(summary.storageResolvedConflicts)
        })
      ]
    : []

  const renderBreadcrumb = () => {
    const currentPath = remoteDirectoryList?.path || '/'
    const parts = normalizeWebDavPath(currentPath, '/').split('/').filter(Boolean)
    let cursor = ''

    return (
      <RowFlex className="min-w-0 flex-wrap items-center gap-1 text-sm">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-foreground hover:bg-muted"
          onClick={() => loadRemoteDirectories('/')}>
          <Home size={14} />
        </button>
        {parts.map((part) => {
          cursor = `${cursor}/${part}`
          const path = cursor
          return (
            <RowFlex key={path} className="min-w-0 items-center gap-1">
              <ChevronRight size={14} className="text-foreground-muted" />
              <button
                type="button"
                className="max-w-[180px] truncate rounded-md px-2 py-1 text-sm hover:bg-muted"
                onClick={() => loadRemoteDirectories(path)}>
                {part}
              </button>
            </RowFlex>
          )
        })}
      </RowFlex>
    )
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.data_sync.title')}</SettingTitle>
      <SettingHelpText>{t('settings.data.data_sync.help')}</SettingHelpText>
      <SettingDivider />

      {loading ? (
        <RowFlex className="items-center gap-2 py-8 text-foreground-muted">
          <Spinner text={t('common.loading')} />
        </RowFlex>
      ) : (
        <>
          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.method')}</SettingRowTitle>
            <RowFlex className="items-center gap-2 text-sm text-foreground-muted">
              <Server size={15} />
              {t('settings.data.data_sync.method_value')}
            </RowFlex>
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.webdav_host')}</SettingRowTitle>
            <Input
              value={webdavHost}
              onPaste={handleWebDavHostPaste}
              onChange={(event) => setWebdavHost(event.target.value)}
              onBlur={() => setWebdavHost((value) => (value ? normalizeWebDavHost(value) : value))}
              placeholder="https://example.com/dav"
              style={{ width: 360, maxWidth: '100%' }}
              type="url"
            />
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.username')}</SettingRowTitle>
            <Input
              value={webdavUser}
              onChange={(event) => setWebdavUser(event.target.value)}
              placeholder={t('settings.data.data_sync.username_placeholder')}
              style={{ width: 260, maxWidth: '100%' }}
            />
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.password')}</SettingRowTitle>
            <Input
              value={webdavPass}
              onChange={(event) => setWebdavPass(event.target.value)}
              placeholder={t('settings.data.data_sync.password_placeholder')}
              style={{ width: 260, maxWidth: '100%' }}
              type="password"
            />
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.remote_path')}</SettingRowTitle>
            <RowFlex className="min-w-0 flex-1 justify-end gap-1.5">
              <Input
                value={webdavPath}
                onChange={(event) => setWebdavPath(event.target.value)}
                onBlur={() => setWebdavPath((value) => normalizeRemotePathInput(value))}
                placeholder={DEFAULT_REMOTE_PATH}
                style={{ width: 260, maxWidth: '100%' }}
              />
              <Button variant="outline" onClick={openDirectoryBrowser} disabled={!webdavHost}>
                <FolderOpen size={14} />
                {t('settings.data.data_sync.remote_path_browse')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{t('settings.data.data_sync.remote_path_help')}</SettingHelpText>
          </SettingRow>
          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.effective_path')}</SettingRowTitle>
            <span className="max-w-full truncate text-foreground-muted text-sm">
              {getEffectiveSyncPath(webdavPath)}
            </span>
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.auto_sync')}</SettingRowTitle>
            <Selector size={14} value={syncInterval} onChange={handleSyncIntervalChange} options={intervalOptions(t)} />
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.sync_now')}</SettingRowTitle>
            <RowFlex className="flex-wrap justify-end gap-1.5">
              <Button variant="outline" onClick={() => refreshStatus(true)} disabled={statusRefreshing}>
                <RefreshCw size={14} className={statusRefreshing ? 'animate-spin' : ''} />
                {t('settings.data.data_sync.refresh_status')}
              </Button>
              <Button variant="outline" onClick={handleDiagnose} loading={diagnosing} disabled={isBusy}>
                <Bug size={14} />
                {t('settings.data.data_sync.diagnose')}
              </Button>
              <Button variant="outline" onClick={handleRestoreLatest} loading={restoring} disabled={isBusy}>
                <RotateCcw size={14} />
                {t('settings.data.data_sync.restore_latest')}
              </Button>
              <Button variant="outline" onClick={handleSave} loading={saving} disabled={isBusy}>
                {t('common.save')}
              </Button>
              <Button onClick={handleSyncNow} loading={syncing || runtimeSyncing} disabled={isBusy && !runtimeSyncing}>
                <Sparkles size={14} />
                {runtimeSyncing ? t('settings.data.data_sync.syncing') : t('settings.data.data_sync.sync')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingDivider />

          <SettingRow>
            <SettingRowTitle>{t('settings.data.data_sync.current_device')}</SettingRowTitle>
            <span className="max-w-[420px] truncate text-foreground-muted text-sm">
              {status?.deviceId || t('settings.data.data_sync.uninitialized')}
            </span>
          </SettingRow>

          {diagnosis && (
            <>
              <SettingDivider />
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <RowFlex className="items-center gap-2">
                  {diagnosis.ok ? (
                    <CheckCircle2 size={16} className="text-green-600" />
                  ) : (
                    <XCircle size={16} className="text-red-600" />
                  )}
                  <span className="font-medium text-sm">{t('settings.data.data_sync.diagnosis.title')}</span>
                </RowFlex>
                <div className="mt-2 space-y-1 text-foreground-muted text-sm">
                  <div>{diagnosis.summary}</div>
                  {diagnosis.remotePath && (
                    <div>{t('settings.data.data_sync.diagnosis.write_path', { path: diagnosis.remotePath })}</div>
                  )}
                  {diagnosis.deviceId && (
                    <div>{t('settings.data.data_sync.diagnosis.device', { deviceId: diagnosis.deviceId })}</div>
                  )}
                  <div>
                    {t('settings.data.data_sync.diagnosis.checked_at', {
                      time: dayjs(diagnosis.checkedAt).format('YYYY-MM-DD HH:mm:ss')
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {summary && (
            <>
              <SettingDivider />
              <div className="rounded-lg border border-border bg-background p-3">
                <RowFlex className="items-center justify-between gap-3">
                  <RowFlex className="items-center gap-2">
                    {summary.status === 'failed' ? (
                      <XCircle size={16} className="text-red-600" />
                    ) : (
                      <CheckCircle2 size={16} className="text-green-600" />
                    )}
                    <span className="font-medium text-sm">{t('settings.data.data_sync.last_result')}</span>
                  </RowFlex>
                  <span className="text-foreground-muted text-xs">
                    {dayjs(summary.lastSyncAt).format('YYYY-MM-DD HH:mm:ss')}
                  </span>
                </RowFlex>
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2 text-sm">
                  {lastResultItems.map((item) => (
                    <span key={item} className="min-w-0 overflow-wrap-anywhere text-foreground-muted">
                      {item}
                    </span>
                  ))}
                </div>
                {summary.remotePath && (
                  <div className="mt-2 break-all text-foreground-muted text-sm">
                    {t('settings.data.data_sync.summary.remote_path', { path: summary.remotePath })}
                  </div>
                )}
                {summary.error && (
                  <div className="mt-2 break-all text-red-600 text-sm">
                    {t('settings.data.data_sync.summary.error', { message: summary.error })}
                  </div>
                )}
                {summary.snapshotUploaded && summary.snapshotFileName && (
                  <div className="mt-2 break-all text-foreground-muted text-sm">
                    {t('settings.data.data_sync.snapshot.uploaded', {
                      file: summary.snapshotFileName,
                      size: formatBytes(summary.snapshotBytes)
                    })}
                  </div>
                )}
                {summary.joinSafetySnapshotPath && (
                  <RowFlex className="mt-2 min-w-0 flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 break-all text-foreground-muted">
                      {t('settings.data.data_sync.snapshot.join_safety', {
                        file: summary.joinSafetySnapshotFileName || summary.joinSafetySnapshotPath,
                        size: formatBytes(summary.joinSafetySnapshotBytes)
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openJoinSafetySnapshot(summary.joinSafetySnapshotPath!)}>
                      {t('settings.data.data_sync.snapshot.open_local')}
                    </Button>
                  </RowFlex>
                )}
              </div>
            </>
          )}
        </>
      )}

      <Dialog open={directoryBrowserOpen} onOpenChange={setDirectoryBrowserOpen}>
        <DialogContent className="max-h-[80vh] max-w-[720px] overflow-hidden p-0">
          <DialogHeader className="border-border border-b px-4 py-3">
            <DialogTitle>{t('settings.data.data_sync.remote_browser.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-[320px] flex-col gap-3 overflow-hidden px-4 py-3">
            {renderBreadcrumb()}
            {directoryError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-600 text-sm">
                {t('settings.data.data_sync.remote_browser.error_title')}: {directoryError}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              {directoryLoading ? (
                <RowFlex className="h-full min-h-[180px] items-center justify-center gap-2 text-foreground-muted">
                  <Spinner text={t('common.loading')} />
                </RowFlex>
              ) : remoteDirectoryList?.directories?.length ? (
                <div className="divide-y divide-border">
                  {remoteDirectoryList.directories.map((directory) => (
                    <RowFlex key={directory.path} className="items-center justify-between gap-3 px-3 py-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left text-sm hover:text-primary"
                        onClick={() => loadRemoteDirectories(directory.path)}>
                        <RowFlex className="min-w-0 items-center gap-2">
                          <FolderOpen size={15} className="shrink-0 text-foreground-muted" />
                          <span className="truncate">{directory.name}</span>
                        </RowFlex>
                      </button>
                      <Button size="sm" variant="outline" onClick={() => selectRemoteDirectory(directory.path)}>
                        {t('common.select')}
                      </Button>
                    </RowFlex>
                  ))}
                </div>
              ) : (
                <RowFlex className="h-full min-h-[180px] items-center justify-center text-foreground-muted text-sm">
                  {t('settings.data.data_sync.remote_browser.empty')}
                </RowFlex>
              )}
            </div>
          </div>
          <DialogFooter className="border-border border-t px-4 py-3">
            <Button
              variant="outline"
              onClick={() =>
                loadRemoteDirectories(remoteDirectoryList?.path || getDirectoryBrowserStartPath(webdavPath))
              }
              disabled={directoryLoading}>
              <RefreshCw size={14} className={directoryLoading ? 'animate-spin' : ''} />
              {t('settings.data.data_sync.remote_browser.refresh')}
            </Button>
            <Button variant="outline" onClick={() => setDirectoryBrowserOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => selectRemoteDirectory(remoteDirectoryList?.path || '/')}>
              {t('settings.data.data_sync.remote_browser.select_current')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingGroup>
  )
}

export default DataSyncSettings
