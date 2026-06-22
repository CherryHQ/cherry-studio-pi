import { Alert, Button, Dialog, DialogContent, Dropzone, DropzoneEmptyState } from '@cherrystudio/ui'
import type { InstalledSkill } from '@types'
import { FolderOpen, Loader2, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSkillMutations } from '../adapters/skillAdapter'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after each successful install so the parent can refetch the grid. */
  onInstalled?: () => void
}

type ImportStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
type InstallingKey = null | 'checking' | 'zip' | 'directory'

const AUTO_CLOSE_DELAY_MS = 1200

/**
 * Import-config dialog for skills — local install only (ZIP file or directory
 * containing `SKILL.md`). Marketplace search lives in 设置 → Skills; the
 * library entry intentionally keeps a tighter surface.
 *
 * Drop-zone + explicit picker buttons share the same pipeline through
 * `useSkillMutations.installFromZip` / `installFromDirectory`. Cache
 * invalidation for `/skills` is handled inside the adapter, so the library
 * grid refreshes automatically after each successful install.
 */
export function ImportSkillDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  const { installFromZip, installFromDirectory } = useSkillMutations()

  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [installing, setInstalling] = useState<InstallingKey>(null)
  const mountedRef = useRef(true)
  const installingRef = useRef<InstallingKey>(null)
  const operationSeqRef = useRef(0)
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoCloseTimer = useCallback(() => {
    if (!autoCloseTimerRef.current) return
    clearTimeout(autoCloseTimerRef.current)
    autoCloseTimerRef.current = null
  }, [])

  useEffect(() => clearAutoCloseTimer, [clearAutoCloseTimer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationSeqRef.current += 1
    }
  }, [])

  // Reset transient state on open / close.
  useEffect(() => {
    if (!open) {
      clearAutoCloseTimer()
      operationSeqRef.current += 1
      setStatus({ kind: 'idle' })
      installingRef.current = null
      setInstalling(null)
    }
  }, [clearAutoCloseTimer, open])

  const isCurrentInstall = useCallback((operationSeq: number) => {
    return mountedRef.current && operationSeqRef.current === operationSeq
  }, [])

  const beginInstall = useCallback((key: Exclude<InstallingKey, null>) => {
    if (installingRef.current) return false
    const operationSeq = ++operationSeqRef.current
    installingRef.current = key
    if (mountedRef.current) {
      setInstalling(key)
    }
    return operationSeq
  }, [])

  const setInstallStage = useCallback((key: Exclude<InstallingKey, null>, operationSeq: number) => {
    if (!mountedRef.current || operationSeqRef.current !== operationSeq) return
    installingRef.current = key
    setInstalling(key)
  }, [])

  const endInstall = useCallback((operationSeq: number) => {
    if (operationSeqRef.current !== operationSeq) return
    installingRef.current = null
    if (mountedRef.current) {
      setInstalling(null)
    }
  }, [])

  const close = () => {
    if (installingRef.current) return
    onOpenChange(false)
  }

  const finishInstall = (skill: InstalledSkill, operationSeq: number) => {
    if (!isCurrentInstall(operationSeq)) return
    setStatus({ kind: 'success', message: t('settings.skills.installSuccess', { name: skill.name }) })
    onInstalled?.()
    clearAutoCloseTimer()
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null
      if (!isCurrentInstall(operationSeq)) return
      onOpenChange(false)
    }, AUTO_CLOSE_DELAY_MS)
  }

  const failInstall = (e: unknown, operationSeq: number, fallbackName?: string) => {
    if (!isCurrentInstall(operationSeq)) return
    const fallback = t('settings.skills.installFailed', { name: fallbackName ?? t('library.type.skill') })
    const message = e instanceof Error && e.message ? e.message : fallback
    setStatus({ kind: 'error', message })
    window.toast?.error(message)
  }

  const handleZipPick = async () => {
    const operationSeq = beginInstall('zip')
    if (!operationSeq) return
    try {
      const selected = await window.api.file.select({
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (!isCurrentInstall(operationSeq)) return
      if (!selected || selected.length === 0) return
      setStatus({ kind: 'idle' })
      const skill = await installFromZip(selected[0].path)
      finishInstall(skill, operationSeq)
    } catch (e) {
      failInstall(e, operationSeq)
    } finally {
      endInstall(operationSeq)
    }
  }

  const handleDirPick = async () => {
    const operationSeq = beginInstall('directory')
    if (!operationSeq) return
    try {
      const selected = await window.api.file.select({
        properties: ['openDirectory']
      })
      if (!isCurrentInstall(operationSeq)) return
      if (!selected || selected.length === 0) return
      setStatus({ kind: 'idle' })
      const skill = await installFromDirectory(selected[0].path)
      finishInstall(skill, operationSeq)
    } catch (e) {
      failInstall(e, operationSeq)
    } finally {
      endInstall(operationSeq)
    }
  }

  /**
   * Drag-and-drop accepts either a single ZIP or a single directory. Settings
   * page uses the same probe (`window.api.file.isDirectory`) since dropped
   * directories show up as `File` entries on Electron.
   */
  const handleDroppedEntry = async (file?: File) => {
    if (!file) return
    const operationSeq = beginInstall('checking')
    if (!operationSeq) return

    try {
      const filePath = window.api.file.getPathForFile(file)
      if (!isCurrentInstall(operationSeq)) return
      if (!filePath) return

      const isDirectory = await window.api.file.isDirectory(filePath)
      if (!isCurrentInstall(operationSeq)) return
      setStatus({ kind: 'idle' })

      if (isDirectory) {
        setInstallStage('directory', operationSeq)
        const skill = await installFromDirectory(filePath)
        finishInstall(skill, operationSeq)
        return
      }

      if (file.name.toLowerCase().endsWith('.zip')) {
        setInstallStage('zip', operationSeq)
        const skill = await installFromZip(filePath)
        finishInstall(skill, operationSeq)
        return
      }

      if (!isCurrentInstall(operationSeq)) return
      setStatus({ kind: 'error', message: t('settings.skills.invalidFormat') })
    } catch (e) {
      failInstall(e, operationSeq, file.name)
    } finally {
      endInstall(operationSeq)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !installing) close()
      }}>
      <DialogContent className="overflow-hidden">
        {/* Header */}
        <div>
          <div>
            <h3 className="font-semibold text-foreground text-lg leading-none">
              {t('library.import_skill_dialog.title')}
            </h3>
            <p className="mt-2 text-foreground-secondary text-sm">{t('library.import_skill_dialog.subtitle')}</p>
          </div>
        </div>

        {/* Body */}
        <div>
          <Dropzone
            disabled={Boolean(installing)}
            getFilesFromEvent={async (event) => {
              if ('dataTransfer' in event && event.dataTransfer) {
                return Array.from(event.dataTransfer.files)
              }

              if ('target' in event && event.target && 'files' in event.target) {
                const target = event.target as HTMLInputElement
                return target.files ? Array.from(target.files) : []
              }

              return []
            }}
            maxFiles={1}
            onDrop={(files, _rejections, event) => {
              const droppedFile = 'dataTransfer' in event ? event.dataTransfer?.files?.[0] : undefined
              void handleDroppedEntry(droppedFile ?? files[0])
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border-muted border-dashed bg-transparent p-8 text-center shadow-none transition-colors hover:border-border-hover hover:bg-accent disabled:pointer-events-none disabled:opacity-60">
            <DropzoneEmptyState>
              <Upload size={26} strokeWidth={1.2} className="mb-3 text-foreground-muted" />
              <p className="mb-1 text-foreground-secondary text-xs">
                {t('library.import_skill_dialog.local.drop_hint')}
              </p>
              <p className="text-foreground-muted text-xs">{t('library.import_skill_dialog.local.formats')}</p>
            </DropzoneEmptyState>
          </Dropzone>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleZipPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'zip' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              <span>{t('settings.skills.installFromZip')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDirPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'directory' ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
              <span>{t('settings.skills.installFromDirectory')}</span>
            </Button>
          </div>

          <StatusBanner status={status} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
      {status.kind === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert
            type="success"
            showIcon
            message={status.message}
            className="rounded-md px-3 py-2 text-xs shadow-none"
          />
        </motion.div>
      )}
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert type="error" showIcon message={status.message} className="rounded-md px-3 py-2 text-xs shadow-none" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
