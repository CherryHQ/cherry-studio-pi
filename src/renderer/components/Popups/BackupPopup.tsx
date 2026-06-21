import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { getBackupProgressLabelKey } from '@renderer/i18n/label'
import { backup, backupToLanTransfer } from '@renderer/services/BackupService'
import { getErrorMessage } from '@renderer/utils/error'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

const logger = loggerService.withContext('BackupPopup')

interface Props {
  resolve: (data: any) => void
  backupType?: 'direct' | 'lan-transfer'
}

type ProgressStageType = 'preparing' | 'copying_database' | 'copying_files' | 'compressing' | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve, backupType = 'direct' }) => {
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const [running, setRunning] = useState(false)
  const mountedRef = useRef(true)
  const operationSeqRef = useRef(0)
  const runningRef = useRef(false)
  const { t } = useTranslation()
  const [skipBackupFile] = usePreference('data.backup.general.skip_backup_file')
  const close = useTopViewClose({ resolve, setOpen, topViewKey: TopViewKey })

  useEffect(() => {
    mountedRef.current = true

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.BackupProgress, (_, data: ProgressData) => {
      if (mountedRef.current) {
        setProgressData(data)
      }
    })

    return () => {
      mountedRef.current = false
      operationSeqRef.current += 1
      runningRef.current = false
      removeListener()
    }
  }, [])

  const isCurrentBackup = (operationSeq: number) => mountedRef.current && operationSeqRef.current === operationSeq

  const onOk = async () => {
    if (runningRef.current) {
      return
    }

    logger.debug(`skipBackupFile: ${skipBackupFile}, backupType: ${backupType}`)

    const operationSeq = ++operationSeqRef.current
    runningRef.current = true
    setRunning(true)
    let didClose = false
    try {
      if (backupType === 'lan-transfer') {
        await backupToLanTransfer()
      } else {
        await backup(skipBackupFile)
      }
      if (!isCurrentBackup(operationSeq)) {
        return
      }

      didClose = true
      close({})
    } catch (error) {
      if (!isCurrentBackup(operationSeq)) {
        return
      }

      logger.error('Backup failed:', error as Error)
      window.toast?.error(`${t('message.backup.failed')}: ${getErrorMessage(error)}`)
    } finally {
      if (operationSeqRef.current === operationSeq) {
        runningRef.current = false
      }
      if (!didClose && isCurrentBackup(operationSeq)) {
        setRunning(false)
      }
    }
  }

  const onCancel = () => {
    if (runningRef.current) {
      return
    }

    close({})
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('backup.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return t(getBackupProgressLabelKey(progressData.stage))
  }

  BackupPopup.hide = onCancel

  const isDisabled = progressData ? progressData.stage !== 'completed' : false
  const isLanTransferMode = backupType === 'lan-transfer'

  const title = isLanTransferMode ? t('settings.data.export_to_phone.file.title') : t('backup.title')
  const okText = isLanTransferMode ? t('settings.data.export_to_phone.file.button') : t('backup.confirm.button')
  const content = isLanTransferMode ? t('settings.data.export_to_phone.file.content') : t('backup.content')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !runningRef.current && onCancel()}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {!progressData && <div>{content}</div>}
        {progressData && (
          <div className="flex flex-col items-center gap-4 py-5 text-center">
            <CircularProgress
              value={Math.floor(progressData.progress)}
              size={72}
              strokeWidth={6}
              showLabel
              renderLabel={(progress) => `${progress}%`}
            />
            <div>{getProgressText()}</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={isDisabled || running} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={isDisabled || running} loading={running} onClick={onOk}>
            {okText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'BackupPopup'

export default class BackupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(backupType: 'direct' | 'lan-transfer' = 'direct') {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer backupType={backupType} resolve={resolve} />, TopViewKey)
    })
  }
}
