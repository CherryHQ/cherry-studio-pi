import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { backupToWebdav } from '@renderer/services/BackupService'
import dayjs from 'dayjs'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface WebdavModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
  customLabels?: {
    modalTitle?: string
    filenamePlaceholder?: string
  }
}

export function useWebdavBackupModal({ backupMethod }: { backupMethod?: typeof backupToWebdav } = {}) {
  const [customFileName, setCustomFileName] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const backupingRef = useRef(false)

  const handleBackup = async () => {
    if (backupingRef.current) {
      return
    }

    backupingRef.current = true
    setBackuping(true)
    try {
      await (backupMethod ?? backupToWebdav)({ showMessage: true, customFileName })
    } finally {
      backupingRef.current = false
      setBackuping(false)
      setIsModalVisible(false)
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

export function WebdavBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName,
  customLabels
}: WebdavModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isModalVisible} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{customLabels?.modalTitle || t('settings.data.webdav.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={customLabels?.filenamePlaceholder || t('settings.data.webdav.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={backuping}>
            {t('common.cancel')}
          </Button>
          <Button loading={backuping} disabled={backuping} onClick={handleBackup}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
