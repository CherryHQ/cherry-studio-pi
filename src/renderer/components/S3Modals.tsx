import {
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner
} from '@cherrystudio/ui'
import { backupToS3 } from '@renderer/services/BackupService'
import { formatFileSize } from '@renderer/utils'
import { runExclusiveOperation } from '@renderer/utils/exclusiveOperation'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

export function useS3BackupModal() {
  const [customFileName, setCustomFileName] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const mountedRef = useRef(true)
  const backupingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleBackup = async () => {
    if (backupingRef.current) {
      return
    }

    backupingRef.current = true
    setBackuping(true)
    try {
      await backupToS3({ customFileName, showMessage: true })
    } finally {
      backupingRef.current = false
      if (mountedRef.current) {
        setBackuping(false)
        setIsModalVisible(false)
      }
    }
  }

  const handleCancel = () => {
    if (backupingRef.current) {
      return
    }
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    // 获取默认文件名
    const deviceType = await window.api.system.getDeviceType()
    const hostname = await window.api.system.getHostname()
    const timestamp = dayjs().format('YYYYMMDDHHmmss')
    const defaultFileName = `cherry-studio-pi.${timestamp}.${hostname}.${deviceType}.zip`
    if (!mountedRef.current) {
      return
    }
    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }, [])

  return {
    isModalVisible,
    handleBackup,
    handleCancel,
    backuping,
    customFileName,
    setCustomFileName,
    showBackupModal
  }
}

type S3BackupModalProps = {
  isModalVisible: boolean
  handleBackup: () => Promise<void>
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

export function S3BackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName
}: S3BackupModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={isModalVisible}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
      }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.s3.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={t('settings.data.s3.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={backuping}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleBackup} loading={backuping} disabled={backuping}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface UseS3RestoreModalProps {
  endpoint: string | undefined
  region: string | undefined
  bucket: string | undefined
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  root?: string | undefined
}

export function useS3RestoreModal({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  root
}: UseS3RestoreModalProps) {
  const [isRestoreModalVisible, setIsRestoreModalVisible] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const mountedRef = useRef(true)
  const listSeqRef = useRef(0)
  const restoringRef = useRef(false)
  const { t } = useTranslation()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      listSeqRef.current += 1
    }
  }, [])

  const showRestoreModal = useCallback(async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.toast?.error(t('settings.data.s3.manager.config.incomplete'))
      return
    }

    const listSeq = ++listSeqRef.current
    setSelectedFile(null)
    setBackupFiles([])
    setIsRestoreModalVisible(true)
    setLoadingFiles(true)
    try {
      const files = await window.api.backup.listS3Files({
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        root,
        autoSync: false,
        syncInterval: 0,
        maxBackups: 0,
        skipBackupFile: false
      })
      if (mountedRef.current && listSeq === listSeqRef.current) {
        setBackupFiles(files)
      }
    } catch (error: any) {
      if (mountedRef.current && listSeq === listSeqRef.current) {
        window.toast?.error(t('settings.data.s3.manager.files.fetch.error', { message: error.message }))
      }
    } finally {
      if (mountedRef.current && listSeq === listSeqRef.current) {
        setLoadingFiles(false)
      }
    }
  }, [endpoint, region, bucket, accessKeyId, secretAccessKey, root, t])

  const handleRestore = useCallback(async () => {
    if (!selectedFile || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.toast?.error(
        !selectedFile ? t('settings.data.s3.restore.file.required') : t('settings.data.s3.restore.config.incomplete')
      )
      return
    }

    window.modal.confirm({
      title: t('settings.data.s3.restore.confirm.title'),
      content: t('settings.data.s3.restore.confirm.content', { fileName: selectedFile }),
      okText: t('settings.data.s3.restore.confirm.ok'),
      cancelText: t('settings.data.s3.restore.confirm.cancel'),
      centered: true,
      onOk: async () => {
        if (!mountedRef.current) {
          return
        }

        await runExclusiveOperation(restoringRef, async () => {
          if (!mountedRef.current) {
            return
          }

          setRestoring(true)
          try {
            await window.api.backup.restoreFromS3({
              endpoint,
              region,
              bucket,
              accessKeyId,
              secretAccessKey,
              root,
              fileName: selectedFile,
              autoSync: false,
              syncInterval: 0,
              maxBackups: 0,
              skipBackupFile: false
            })
            if (mountedRef.current) {
              window.toast?.success(t('message.restore.success'))
              setIsRestoreModalVisible(false)
            }
          } catch (error: any) {
            if (mountedRef.current) {
              window.toast?.error(t('settings.data.s3.restore.error', { message: error.message }))
            }
          } finally {
            if (mountedRef.current) {
              setRestoring(false)
            }
          }
        })
      }
    })
  }, [selectedFile, endpoint, region, bucket, accessKeyId, secretAccessKey, root, t])

  const handleCancel = () => {
    if (restoringRef.current) {
      return
    }

    listSeqRef.current += 1
    setLoadingFiles(false)
    setIsRestoreModalVisible(false)
  }

  return {
    isRestoreModalVisible,
    handleRestore,
    handleCancel,
    restoring,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    backupFiles,
    showRestoreModal
  }
}

type S3RestoreModalProps = ReturnType<typeof useS3RestoreModal>

export function S3RestoreModal({
  isRestoreModalVisible,
  handleRestore,
  handleCancel,
  restoring,
  selectedFile,
  setSelectedFile,
  loadingFiles,
  backupFiles
}: S3RestoreModalProps) {
  const { t } = useTranslation()
  const fileOptions = backupFiles.map(formatFileOption)

  return (
    <Dialog
      open={isRestoreModalVisible}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
      }}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.s3.restore.modal.title')}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Combobox
            width="100%"
            placeholder={t('settings.data.s3.restore.modal.select.placeholder')}
            value={selectedFile ?? ''}
            onChange={(value) => setSelectedFile(Array.isArray(value) ? (value[0] ?? null) : value || null)}
            options={fileOptions}
            disabled={loadingFiles}
            searchable
            filterOption={(option, search) => option.label.toLowerCase().includes(search.toLowerCase())}
          />
          {loadingFiles && (
            <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2">
              <Spinner text={t('common.loading')} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={restoring}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleRestore} loading={restoring} disabled={restoring}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatFileOption(file: BackupFile): ComboboxOption {
  const date = dayjs(file.modifiedTime).format('YYYY-MM-DD HH:mm:ss')
  const size = formatFileSize(file.size)
  return {
    label: `${file.fileName} (${date}, ${size})`,
    value: file.fileName
  }
}
