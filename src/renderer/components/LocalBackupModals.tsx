import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { backupToLocal } from '@renderer/services/BackupService'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalBackupModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

const logger = loggerService.withContext('LocalBackupModal')

export function LocalBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName
}: LocalBackupModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isModalVisible} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.local.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={t('settings.data.local.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={backuping}>
            {t('common.cancel')}
          </Button>
          <Button disabled={backuping} onClick={handleBackup}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Hook for backup modal
export function useLocalBackupModal(localBackupDir: string | undefined) {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const [customFileName, setCustomFileName] = useState('')
  const mountedRef = useRef(true)
  const backupingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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

  const handleBackup = async () => {
    if (backupingRef.current) {
      return
    }

    if (!localBackupDir) {
      if (mountedRef.current) {
        setIsModalVisible(false)
      }
      return
    }

    backupingRef.current = true
    setBackuping(true)
    try {
      await backupToLocal({
        showMessage: true,
        customFileName: customFileName || undefined
      })
      if (mountedRef.current) {
        setIsModalVisible(false)
      }
    } catch (error) {
      logger.error('Backup failed:', error as Error)
    } finally {
      backupingRef.current = false
      if (mountedRef.current) {
        setBackuping(false)
      }
    }
  }

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
