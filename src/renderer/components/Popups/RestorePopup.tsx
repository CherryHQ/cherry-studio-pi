import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { getRestoreProgressLabelKey } from '@renderer/i18n/label'
import { restore } from '@renderer/services/BackupService'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

interface Props {
  resolve: (data: any) => void
}

interface ProgressData {
  stage: string
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const [running, setRunning] = useState(false)
  const mountedRef = useRef(true)
  const operationSeqRef = useRef(0)
  const runningRef = useRef(false)
  const { t } = useTranslation()
  const close = useTopViewClose({ resolve, setOpen, topViewKey: TopViewKey })

  useEffect(() => {
    mountedRef.current = true

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.RestoreProgress, (_, data: ProgressData) => {
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

  const isCurrentRestore = (operationSeq: number) => mountedRef.current && operationSeqRef.current === operationSeq

  const onOk = async () => {
    if (runningRef.current) {
      return
    }

    const operationSeq = ++operationSeqRef.current
    runningRef.current = true
    setRunning(true)
    let didClose = false
    try {
      await restore()
      if (!isCurrentRestore(operationSeq)) {
        return
      }

      didClose = true
      close({})
    } finally {
      if (operationSeqRef.current === operationSeq) {
        runningRef.current = false
      }
      if (!didClose && isCurrentRestore(operationSeq)) {
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
      return t('restore.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return t(getRestoreProgressLabelKey(progressData.stage))
  }

  RestorePopup.hide = onCancel

  const isDisabled = progressData ? progressData.stage !== 'completed' : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !runningRef.current && onCancel()}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('restore.title')}</DialogTitle>
        </DialogHeader>
        {!progressData && <div>{t('restore.content')}</div>}
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
            {t('restore.confirm.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'RestorePopup'

export default class RestorePopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, TopViewKey)
    })
  }
}
