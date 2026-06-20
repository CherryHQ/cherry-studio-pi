import { BugOutlined, FolderOpenOutlined, HomeOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  refreshDataSyncRuntimeStateFromMain,
  startDataSyncAutoSync,
  stopDataSyncAutoSync,
  subscribeDataSyncRuntimeState,
  syncAppDataNow
} from '@renderer/services/DataSyncService'
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
import { normalizeWebDavConfig, normalizeWebDavHost, normalizeWebDavPath, parseWebDavInput } from '@shared/webdavConfig'
import { Alert, Breadcrumb, Button, Empty, Input, List, Modal, Space, Spin, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
import type { CSSProperties, FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const HStack = ({ children, gap, style }: { children: ReactNode; gap?: number | string; style?: CSSProperties }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap, ...style }}>{children}</div>
)

type SyncSummary = {
  status?: 'success' | 'failed'
  error?: string | null
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  resolvedConflicts?: number
  skipped: number
  storageUploaded?: number
  storageDownloaded?: number
  storageDeleted?: number
  storageConflicts?: number
  storageResolvedConflicts?: number
  storageSkipped?: number
  blobUploaded?: number
  blobDownloaded?: number
  secretUploaded?: number
  secretDownloaded?: number
  snapshotUploaded?: boolean
  snapshotFileName?: string | null
  snapshotBytes?: number
  joinSafetySnapshotCreated?: boolean
  joinSafetySnapshotFileName?: string | null
  joinSafetySnapshotPath?: string | null
  joinSafetySnapshotBytes?: number
  remotePath?: string | null
  remoteGeneration?: number | null
  remoteManifestHash?: string | null
  syncSpaceId?: string | null
  storageBundleHash?: string | null
  storageRecordCount?: number
  storageBlobCount?: number
  lastSyncAt: number
}

type SyncStatus = {
  deviceId: string
  lastSummary: SyncSummary
  conflicts: unknown[]
  syncing: boolean
  syncStartedAt?: number | null
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

type DiagnosisState = {
  ok: boolean
  summary: string
  checkedAt: number
  remotePath?: string
  deviceId?: string
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
  return normalizeWebDavHost(value)
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

function normalizeDirectoryBrowserPath(value?: string) {
  return normalizeWebDavPath(value, '/')
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function summaryCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isDataSyncAlreadyRunningError(error: unknown) {
  return /Data sync is already running|已有数据同步正在进行|同步正在进行/i.test(getErrorMessage(error))
}

function readClipboardText(clipboardData: DataTransfer) {
  return clipboardData.getData('text/plain') || clipboardData.getData('text') || clipboardData.getData('Text')
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

const lastResultBodyStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8
}

const lastResultMetaStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px 12px',
  minWidth: 0
}

const lastResultMetricGridStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
  gap: '6px 12px'
}

const lastResultTextStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word'
}

const lastResultActionStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6
}

const lastResultErrorStyle: CSSProperties = {
  ...lastResultTextStyle,
  display: 'block'
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
  const [runtimeSyncing, setRuntimeSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisState | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [statusRefreshing, setStatusRefreshing] = useState(false)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [remoteDirectoryList, setRemoteDirectoryList] = useState<RemoteDirectoryList | null>(null)
  const statusRefreshSeqRef = useRef(0)
  const statusRefreshLoadingSeqRef = useRef(0)
  const directoryLoadSeqRef = useRef(0)
  const diagnosisSeqRef = useRef(0)
  const syncNowRef = useRef(false)
  const restoreSnapshotRef = useRef(false)
  const restoreSnapshotOperationRef = useRef(false)
  const restoreSnapshotConfirmRef = useRef<ReturnType<typeof Modal.confirm> | null>(null)
  const diagnosisRef = useRef(false)
  const mountedRef = useRef(true)
  const statusRefreshFeedbackRef = useRef({ t, webdavHost, webdavPath })
  statusRefreshFeedbackRef.current = { t, webdavHost, webdavPath }

  useEffect(() => {
    return () => {
      mountedRef.current = false
      statusRefreshSeqRef.current += 1
      statusRefreshLoadingSeqRef.current += 1
      directoryLoadSeqRef.current += 1
      diagnosisSeqRef.current += 1
      restoreSnapshotConfirmRef.current?.destroy()
      restoreSnapshotConfirmRef.current = null
      restoreSnapshotRef.current = false
    }
  }, [])

  useEffect(() => {
    setWebdavHost(dataSyncWebdavHost)
  }, [dataSyncWebdavHost])

  useEffect(() => {
    setWebdavUser(dataSyncWebdavUser)
  }, [dataSyncWebdavUser])

  useEffect(() => {
    setWebdavPass(dataSyncWebdavPass)
  }, [dataSyncWebdavPass])

  useEffect(() => {
    setWebdavPath(dataSyncWebdavPath)
  }, [dataSyncWebdavPath])

  useEffect(() => {
    setSyncInterval(dataSyncSyncInterval)
  }, [dataSyncSyncInterval])

  const applyStructuredWebDavInput = (value: string) => {
    const parsed = parseWebDavInput(value)
    if (!parsed.structured) return false

    const normalized = normalizeWebDavConfig(
      {
        webdavHost: parsed.webdavHost,
        webdavUser: parsed.webdavUser || webdavUser,
        webdavPass: parsed.webdavPass || webdavPass,
        webdavPath: parsed.webdavPath || webdavPath
      },
      { defaultPath: DEFAULT_REMOTE_PATH }
    )

    setWebdavHost(normalized.webdavHost)
    setWebdavUser(normalized.webdavUser)
    setWebdavPass(normalized.webdavPass)
    setWebdavPath(normalized.webdavPath)
    dispatch(setDataSyncWebdavHost(normalized.webdavHost))
    dispatch(setDataSyncWebdavUser(normalized.webdavUser))
    dispatch(setDataSyncWebdavPass(normalized.webdavPass))
    dispatch(setDataSyncWebdavPath(normalized.webdavPath))
    return true
  }

  const saveWebDavConfig = (nextPath = webdavPath) => {
    const normalized = normalizeWebDavConfig(
      {
        webdavHost,
        webdavUser,
        webdavPass,
        webdavPath: nextPath
      },
      { defaultPath: DEFAULT_REMOTE_PATH }
    )

    setWebdavHost(normalized.webdavHost)
    setWebdavUser(normalized.webdavUser)
    setWebdavPass(normalized.webdavPass)
    setWebdavPath(normalized.webdavPath)
    dispatch(setDataSyncWebdavHost(normalized.webdavHost))
    dispatch(setDataSyncWebdavUser(normalized.webdavUser))
    dispatch(setDataSyncWebdavPass(normalized.webdavPass))
    dispatch(setDataSyncWebdavPath(normalized.webdavPath))

    return normalized
  }

  const trySaveWebDavConfig = (nextPath = webdavPath) => {
    try {
      return saveWebDavConfig(nextPath)
    } catch (error) {
      window.toast.error(getErrorMessage(error))
      return null
    }
  }

  const refreshStatus = useCallback(async (showLoading = false) => {
    const requestSeq = ++statusRefreshSeqRef.current
    const isLatestRequest = () => requestSeq === statusRefreshSeqRef.current
    let loadingSeq: number | null = null
    if (showLoading) {
      loadingSeq = ++statusRefreshLoadingSeqRef.current
      setStatusRefreshing(true)
    }
    try {
      const nextStatus = await window.api.dataSync.getStatus()
      if (!isLatestRequest()) return null

      setStatus(nextStatus)
      setSyncing(syncNowRef.current || Boolean(nextStatus.syncing))
      if (!nextStatus.syncing) {
        const runtimeState = await refreshDataSyncRuntimeStateFromMain().catch(() => null)
        if (runtimeState && isLatestRequest()) {
          setRuntimeSyncing(runtimeState.syncing)
        }
      }
      return nextStatus
    } catch (error) {
      if (!isLatestRequest()) return null

      setSyncing(syncNowRef.current)
      setRuntimeSyncing(false)
      setStatus((prev) => (prev ? { ...prev, syncing: false, syncStartedAt: null } : prev))
      if (showLoading) {
        const feedback = statusRefreshFeedbackRef.current
        window.toast.error(`${feedback.t('common.operation_failed')}: ${getErrorMessage(error)}`)
        void reportErrorToSystemAgent(
          error,
          {
            source: 'settings.data_sync.refresh_status',
            domain: 'dataSync',
            details: {
              webdavHost: feedback.webdavHost,
              webdavPath: normalizeRemotePathInput(feedback.webdavPath)
            }
          },
          { showToast: false }
        )
      }
      return null
    } finally {
      if (loadingSeq !== null && loadingSeq === statusRefreshLoadingSeqRef.current) {
        setStatusRefreshing(false)
      }
    }
  }, [])

  const isSyncing = (nextStatus?: SyncStatus | null) => {
    return Boolean(nextStatus?.syncing)
  }

  const syncInProgress = syncing || runtimeSyncing || Boolean(status?.syncing)
  const webDavConfigComplete = Boolean(webdavHost.trim() && webdavUser.trim() && webdavPass)

  const warnWebDavConfigRequired = () => {
    window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
  }

  useEffect(() => {
    void refreshStatus().catch(() => undefined)
  }, [refreshStatus])

  useEffect(() => subscribeDataSyncRuntimeState((state) => setRuntimeSyncing(state.syncing)), [])

  useEffect(() => {
    const refreshInterval = syncInProgress ? 2_000 : 10_000
    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => undefined)
    }, refreshInterval)

    return () => window.clearInterval(timer)
  }, [refreshStatus, syncInProgress])

  const syncNow = async () => {
    if (!webDavConfigComplete) {
      warnWebDavConfigRequired()
      return
    }

    if (syncNowRef.current) {
      setSyncing(true)
      window.toast.info(t('settings.data.data_sync.toast.sync_running'))
      return
    }

    if (syncInProgress) {
      const nextStatus = await refreshStatus().catch(() => null)
      if (nextStatus?.syncing) {
        window.toast.info(t('settings.data.data_sync.toast.sync_running'))
      }
      return
    }

    const config = trySaveWebDavConfig()
    if (!config) return

    let latestStatus: SyncStatus | null = null
    let completedSummary: SyncSummary | null = null
    let keepSyncingWhenStatusUnknown = false
    syncNowRef.current = true
    setSyncing(true)
    try {
      const summary = await syncAppDataNow(config)
      if (!mountedRef.current) return

      if (!summary) {
        const nextStatus = await refreshStatus().catch(() => null)
        if (!mountedRef.current) return

        latestStatus = nextStatus
        keepSyncingWhenStatusUnknown = true
        window.toast.info(t('settings.data.data_sync.toast.sync_running'))
        return
      }

      if (summary) {
        completedSummary = summary
        setStatus((prev) => ({
          deviceId: prev?.deviceId || '',
          conflicts: prev?.conflicts || [],
          lastSummary: summary,
          syncing: false,
          syncStartedAt: null
        }))
      }
      latestStatus = await refreshStatus().catch(() => null)
      if (!mountedRef.current) return

      window.toast.success(t('settings.data.data_sync.toast.sync_success'))
    } catch (error) {
      latestStatus = await refreshStatus().catch(() => null)
      if (!mountedRef.current) return

      if (isDataSyncAlreadyRunningError(error)) {
        keepSyncingWhenStatusUnknown = true
        setSyncing(latestStatus ? isSyncing(latestStatus) : true)
        window.toast.info(t('settings.data.data_sync.toast.sync_running'))
        return
      }

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
      if (mountedRef.current && !latestStatus && !completedSummary) {
        latestStatus = await refreshStatus().catch(() => null)
      }

      if (mountedRef.current) {
        setSyncing(latestStatus ? isSyncing(latestStatus) : keepSyncingWhenStatusUnknown)
      }
      syncNowRef.current = false
    }
  }

  const restoreLatestSnapshot = () => {
    if (!webDavConfigComplete) {
      warnWebDavConfigRequired()
      return
    }

    const config = trySaveWebDavConfig()
    if (!config) return

    if (restoreSnapshotRef.current || restoreSnapshotOperationRef.current) {
      return
    }

    restoreSnapshotRef.current = true
    restoreSnapshotConfirmRef.current = Modal.confirm({
      title: t('settings.data.data_sync.restore_confirm_title'),
      content: t('settings.data.data_sync.restore_confirm_content'),
      okText: t('settings.data.data_sync.restore_latest'),
      okButtonProps: { danger: true },
      onCancel: () => {
        restoreSnapshotRef.current = false
        restoreSnapshotConfirmRef.current = null
      },
      onOk: async () => {
        if (!mountedRef.current || restoreSnapshotOperationRef.current) {
          return
        }

        restoreSnapshotOperationRef.current = true
        setRestoring(true)
        try {
          await window.api.dataSync.restoreLatestSnapshot(config)
          if (!mountedRef.current) return

          window.toast.success(t('settings.data.data_sync.toast.restore_success'))
        } catch (error) {
          if (!mountedRef.current) return

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
          if (mountedRef.current) {
            setRestoring(false)
          }
          restoreSnapshotOperationRef.current = false
          restoreSnapshotRef.current = false
          restoreSnapshotConfirmRef.current = null
        }
      }
    })
  }

  const revealLocalSafetySnapshot = async (filePath?: string | null) => {
    if (!filePath) return

    try {
      await window.api.file.showInFolder(filePath)
    } catch (error) {
      window.toast.error(t('settings.data.data_sync.toast.open_snapshot_failed', { message: getErrorMessage(error) }))
      void reportErrorToSystemAgent(
        error,
        {
          source: 'settings.data_sync.open_local_safety_snapshot',
          domain: 'dataSync',
          details: { path: filePath }
        },
        { showToast: true }
      )
    }
  }

  const diagnoseNow = async () => {
    if (!webDavConfigComplete) {
      warnWebDavConfigRequired()
      return
    }

    if (diagnosisRef.current) {
      return
    }

    const config = trySaveWebDavConfig()
    if (!config) return

    const requestSeq = ++diagnosisSeqRef.current
    const isLatestRequest = () => requestSeq === diagnosisSeqRef.current
    diagnosisRef.current = true
    setDiagnosing(true)
    try {
      const [writeCheck, nextStatus] = await Promise.all([
        window.api.dataSync.checkWriteAccess(config),
        window.api.dataSync.getStatus()
      ])
      if (!isLatestRequest()) return

      const nextDiagnosis: DiagnosisState = {
        ok: true,
        summary: t('settings.data.data_sync.diagnosis.write_success'),
        checkedAt: Date.now(),
        remotePath: writeCheck.basePath,
        deviceId: nextStatus.deviceId
      }

      setDiagnosis(nextDiagnosis)
      setStatus(nextStatus)
      window.toast.success(t('settings.data.data_sync.toast.diagnose_success'))
    } catch (error) {
      if (!isLatestRequest()) return

      const message = getErrorMessage(error)
      setDiagnosis({
        ok: false,
        summary: message,
        checkedAt: Date.now()
      })
      window.toast.error(t('settings.data.data_sync.toast.diagnose_failed', { message }))
      void reportErrorToSystemAgent(
        error,
        {
          source: 'settings.data_sync.diagnose',
          domain: 'dataSync',
          details: {
            webdavHost,
            webdavPath: normalizeRemotePathInput(webdavPath)
          }
        },
        { showToast: true }
      )
    } finally {
      diagnosisRef.current = false
      if (isLatestRequest()) {
        setDiagnosing(false)
      }
    }
  }

  const summary = status?.lastSummary
  const effectiveSyncPath = getEffectiveSyncPath(webdavPath)

  const loadRemoteDirectories = async (path: string, configOverride?: ReturnType<typeof normalizeWebDavConfig>) => {
    const requestSeq = ++directoryLoadSeqRef.current
    const isLatestRequest = () => requestSeq === directoryLoadSeqRef.current
    let normalizedConfig: ReturnType<typeof normalizeWebDavConfig>
    try {
      normalizedConfig =
        configOverride ??
        normalizeWebDavConfig(
          {
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          },
          { defaultPath: DEFAULT_REMOTE_PATH, requireCredentials: true }
        )
    } catch (error) {
      window.toast.error(getErrorMessage(error))
      return
    }

    if (!normalizedConfig.webdavHost) {
      window.toast.warning(t('settings.data.data_sync.toast.webdav_required'))
      return
    }

    setDirectoryLoading(true)
    setDirectoryError(null)
    try {
      const result = await window.api.dataSync.listRemoteDirectories(
        {
          webdavHost: normalizedConfig.webdavHost,
          webdavUser: normalizedConfig.webdavUser,
          webdavPass: normalizedConfig.webdavPass,
          webdavPath: normalizedConfig.webdavPath
        },
        path
      )
      if (!isLatestRequest()) return

      setRemoteDirectoryList(result)
    } catch (error) {
      if (!isLatestRequest()) return

      setDirectoryError(getErrorMessage(error))
      void reportErrorToSystemAgent(
        error,
        {
          source: 'settings.data_sync.remote_directory_browser',
          domain: 'dataSync',
          details: {
            remotePath: path,
            webdavHost: normalizedConfig.webdavHost,
            webdavPath: normalizedConfig.webdavPath
          }
        },
        { showToast: true }
      )
    } finally {
      if (isLatestRequest()) {
        setDirectoryLoading(false)
      }
    }
  }

  const closeDirectoryBrowser = () => {
    directoryLoadSeqRef.current += 1
    setDirectoryBrowserOpen(false)
    setDirectoryLoading(false)
    setDirectoryError(null)
    setRemoteDirectoryList(null)
  }

  const openDirectoryBrowser = () => {
    if (!webDavConfigComplete) {
      warnWebDavConfigRequired()
      return
    }

    const normalizedConfig = trySaveWebDavConfig()
    if (!normalizedConfig) return
    setDirectoryBrowserOpen(true)
    void loadRemoteDirectories(getDirectoryBrowserStartPath(normalizedConfig.webdavPath), normalizedConfig)
  }

  const selectRemotePath = (path: string) => {
    const config = trySaveWebDavConfig(path)
    if (!config) return
    closeDirectoryBrowser()
    window.toast.success(
      t('settings.data.data_sync.toast.remote_path_selected', { path: normalizeRemotePathInput(path) })
    )
  }

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    if (!trySaveWebDavConfig()) return
    dispatch(setDataSyncSyncInterval(value))
    dispatch(setDataSyncAutoSync(value > 0))

    if (value > 0) {
      startDataSyncAutoSync(true)
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
          onChange={(event) => {
            const value = event.target.value
            try {
              if (applyStructuredWebDavInput(value)) {
                return
              }
            } catch {
              // Keep the raw value visible while the user is still editing; validation runs on blur/actions.
            }
            setWebdavHost(value)
          }}
          onPaste={(event) => {
            const text = readClipboardText(event.clipboardData)
            if (!text) return

            try {
              if (applyStructuredWebDavInput(text)) {
                event.preventDefault()
              }
            } catch (error) {
              event.preventDefault()
              window.toast.error(getErrorMessage(error))
            }
          }}
          onBlur={() => {
            try {
              if (applyStructuredWebDavInput(webdavHost)) {
                return
              }

              const normalizedHost = normalizeWebdavHostInput(webdavHost)
              setWebdavHost(normalizedHost)
              dispatch(setDataSyncWebdavHost(normalizedHost))
              if (!normalizedHost) {
                setSyncInterval(0)
                dispatch(setDataSyncSyncInterval(0))
                dispatch(setDataSyncAutoSync(false))
                stopDataSyncAutoSync()
              }
            } catch (error) {
              window.toast.error(getErrorMessage(error))
            }
          }}
          style={{ width: 280 }}
          inputMode="url"
          type="text"
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
          <Button icon={<FolderOpenOutlined />} disabled={!webDavConfigComplete} onClick={openDirectoryBrowser}>
            {t('settings.data.data_sync.remote_path_browse')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.data_sync.remote_path_help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.effective_path')}</SettingRowTitle>
        <Typography.Text type="secondary" copyable style={{ maxWidth: 360, wordBreak: 'break-all' }}>
          {effectiveSyncPath}
        </Typography.Text>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.data_sync.effective_path_help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.auto_sync')}</SettingRowTitle>
        <Selector
          size={14}
          value={syncInterval}
          onChange={onSyncIntervalChange}
          disabled={!webDavConfigComplete}
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
        <HStack gap="8px">
          <Typography.Text type="secondary" copyable>
            {status?.deviceId || t('settings.data.data_sync.uninitialized')}
          </Typography.Text>
          <Button
            size="small"
            icon={<ReloadOutlined spin={statusRefreshing} />}
            loading={statusRefreshing}
            onClick={() => void refreshStatus(true)}>
            {t('settings.data.data_sync.refresh_status')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.data_sync.sync_now')}</SettingRowTitle>
        <HStack gap="8px" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            icon={<SyncOutlined spin={syncInProgress} />}
            loading={syncInProgress}
            disabled={!webDavConfigComplete || syncInProgress || restoring || diagnosing}
            onClick={syncNow}>
            {t('settings.data.data_sync.sync')}
          </Button>
          <Button
            icon={<BugOutlined />}
            loading={diagnosing}
            disabled={!webDavConfigComplete || syncInProgress || restoring}
            onClick={diagnoseNow}>
            {t('settings.data.data_sync.diagnose')}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={restoring}
            disabled={!webDavConfigComplete || syncInProgress || diagnosing}
            onClick={restoreLatestSnapshot}>
            {t('settings.data.data_sync.restore_latest')}
          </Button>
        </HStack>
      </SettingRow>
      {diagnosis && (
        <>
          <SettingDivider />
          <SettingRow>
            <Alert
              showIcon
              type={diagnosis.ok ? 'success' : 'warning'}
              message={t('settings.data.data_sync.diagnosis.title')}
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text>{diagnosis.summary}</Typography.Text>
                  <Typography.Text type="secondary">
                    {t('settings.data.data_sync.diagnosis.checked_at', {
                      time: dayjs(diagnosis.checkedAt).format('YYYY-MM-DD HH:mm:ss')
                    })}
                  </Typography.Text>
                  {diagnosis.remotePath && (
                    <Typography.Text type="secondary">
                      {t('settings.data.data_sync.diagnosis.write_path', { path: diagnosis.remotePath })}
                    </Typography.Text>
                  )}
                  {diagnosis.deviceId && (
                    <Typography.Text type="secondary">
                      {t('settings.data.data_sync.diagnosis.device', { deviceId: diagnosis.deviceId })}
                    </Typography.Text>
                  )}
                </Space>
              }
              style={{ flex: 1 }}
            />
          </SettingRow>
        </>
      )}
      {summary && summary.lastSyncAt > 0 && (
        <>
          <SettingDivider />
          <SettingRow style={{ alignItems: 'flex-start', gap: 16 }}>
            <SettingRowTitle>{t('settings.data.data_sync.last_result')}</SettingRowTitle>
            <div data-testid="data-sync-last-result" style={lastResultBodyStyle}>
              <div style={lastResultMetaStyle}>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {dayjs(summary.lastSyncAt).format('YYYY-MM-DD HH:mm:ss')}
                </Typography.Text>
                {summary.status && (
                  <Typography.Text
                    type={summary.status === 'failed' ? 'danger' : 'success'}
                    style={lastResultTextStyle}>
                    {t(
                      summary.status === 'failed'
                        ? 'settings.data.data_sync.summary.status_failed'
                        : 'settings.data.data_sync.summary.status_success'
                    )}
                  </Typography.Text>
                )}
                {summary.remotePath && (
                  <Typography.Text type="secondary" copyable style={lastResultTextStyle}>
                    {t('settings.data.data_sync.summary.remote_path', { path: summary.remotePath })}
                  </Typography.Text>
                )}
              </div>
              {summary.error && (
                <Typography.Text type="danger" style={lastResultErrorStyle}>
                  {t('settings.data.data_sync.summary.error', { message: summary.error })}
                </Typography.Text>
              )}
              <div data-testid="data-sync-last-result-metrics" style={lastResultMetricGridStyle}>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.summary.uploaded', { count: summaryCount(summary.uploaded) })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.summary.downloaded', { count: summaryCount(summary.downloaded) })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.summary.deleted', { count: summaryCount(summary.deleted) })}
                </Typography.Text>
                <Typography.Text
                  type={summaryCount(summary.conflicts) ? 'warning' : 'secondary'}
                  style={lastResultTextStyle}>
                  {t('settings.data.data_sync.summary.conflicts', { count: summaryCount(summary.conflicts) })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.summary.resolved_conflicts', {
                    count: summaryCount(summary.resolvedConflicts)
                  })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.storage.records', {
                    uploaded: summaryCount(summary.storageUploaded),
                    downloaded: summaryCount(summary.storageDownloaded)
                  })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.storage.blobs', {
                    uploaded: summaryCount(summary.blobUploaded),
                    downloaded: summaryCount(summary.blobDownloaded)
                  })}
                </Typography.Text>
                <Typography.Text
                  type={summaryCount(summary.storageConflicts) ? 'warning' : 'secondary'}
                  style={lastResultTextStyle}>
                  {t('settings.data.data_sync.storage.conflicts', { count: summaryCount(summary.storageConflicts) })}
                </Typography.Text>
                <Typography.Text type="secondary" style={lastResultTextStyle}>
                  {t('settings.data.data_sync.storage.resolved_conflicts', {
                    count: summaryCount(summary.storageResolvedConflicts)
                  })}
                </Typography.Text>
                {summary.snapshotUploaded && (
                  <Typography.Text type="secondary" style={lastResultTextStyle}>
                    {t('settings.data.data_sync.snapshot.uploaded', {
                      file: summary.snapshotFileName || '-',
                      size: formatBytes(summaryCount(summary.snapshotBytes))
                    })}
                  </Typography.Text>
                )}
                {summary.joinSafetySnapshotCreated && (
                  <div style={lastResultActionStyle}>
                    <Typography.Text
                      type="warning"
                      copyable={summary.joinSafetySnapshotPath ? { text: summary.joinSafetySnapshotPath } : false}
                      style={lastResultTextStyle}>
                      {t('settings.data.data_sync.snapshot.join_safety', {
                        file: summary.joinSafetySnapshotFileName || '-',
                        size: formatBytes(summaryCount(summary.joinSafetySnapshotBytes))
                      })}
                    </Typography.Text>
                    {summary.joinSafetySnapshotPath && (
                      <Tooltip title={t('settings.data.data_sync.snapshot.open_local')}>
                        <Button
                          size="small"
                          icon={<FolderOpenOutlined />}
                          aria-label={t('settings.data.data_sync.snapshot.open_local')}
                          onClick={() => void revealLocalSafetySnapshot(summary.joinSafetySnapshotPath)}
                        />
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            </div>
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
        onCancel={closeDirectoryBrowser}
        footer={
          <Space>
            <Button onClick={() => selectRemotePath('/')}>
              {t('settings.data.data_sync.remote_browser.use_root')}
            </Button>
            <Button onClick={() => selectRemotePath(normalizeRemotePathInput(webdavPath))}>
              {t('settings.data.data_sync.remote_browser.use_current_path')}
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
          <Alert
            showIcon
            type="info"
            message={t('settings.data.data_sync.remote_browser.path_hint_title')}
            description={
              <Space direction="vertical" size={8}>
                <Typography.Text type="secondary">
                  {t('settings.data.data_sync.remote_browser.path_hint', {
                    path: normalizeRemotePathInput(webdavPath)
                  })}
                </Typography.Text>
                <Button size="small" onClick={() => selectRemotePath(normalizeRemotePathInput(webdavPath))}>
                  {t('settings.data.data_sync.remote_browser.use_current_path')}
                </Button>
              </Space>
            }
          />
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
