import { loggerService } from '@logger'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { fetchNoteSummary } from '@renderer/services/ApiService'
import type { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('UseNotesEditing')

interface UseNotesEditingProps {
  onRenameNode: (nodeId: string, newName: string) => void
}

export const useNotesEditing = ({ onRenameNode }: UseNotesEditingProps) => {
  const { t } = useTranslation()
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [renamingNodeIds, setRenamingNodeIds] = useState<Set<string>>(new Set())
  const [newlyRenamedNodeIds, setNewlyRenamedNodeIds] = useState<Set<string>>(new Set())
  const isMountedRef = useRef(true)
  const newlyRenamedClearTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      for (const timer of newlyRenamedClearTimersRef.current) {
        clearTimeout(timer)
      }
      newlyRenamedClearTimersRef.current.clear()
    }
  }, [])

  const inPlaceEdit = useInPlaceEdit({
    onSave: (newName: string) => {
      if (editingNodeId && newName) {
        onRenameNode(editingNodeId, newName)
        window.toast.success(t('common.saved'))
        logger.debug(`Renamed node ${editingNodeId} to "${newName}"`)
      }
      setEditingNodeId(null)
    },
    onCancel: () => {
      setEditingNodeId(null)
    }
  })

  const handleStartEdit = useCallback(
    (node: NotesTreeNode) => {
      setEditingNodeId(node.id)
      inPlaceEdit.startEdit(node.name)
    },
    [inPlaceEdit]
  )

  const handleAutoRename = useCallback(
    async (note: NotesTreeNode) => {
      if (note.type !== 'file') return

      setRenamingNodeIds((prev) => new Set(prev).add(note.id))
      try {
        const content = await window.api.file.readExternal(note.externalPath)
        if (!isMountedRef.current) return

        if (!content || content.trim().length === 0) {
          window.toast.warning(t('notes.auto_rename.empty_note'))
          return
        }

        const summaryText = await fetchNoteSummary({ content })
        if (!isMountedRef.current) return

        if (summaryText) {
          onRenameNode(note.id, summaryText)
          window.toast.success(t('notes.auto_rename.success'))
        } else {
          window.toast.error(t('notes.auto_rename.failed'))
        }
      } catch (error) {
        if (isMountedRef.current) {
          window.toast.error(t('notes.auto_rename.failed'))
          logger.error(`Failed to auto-rename note: ${error}`)
        }
      } finally {
        if (isMountedRef.current) {
          setRenamingNodeIds((prev) => {
            const next = new Set(prev)
            next.delete(note.id)
            return next
          })

          setNewlyRenamedNodeIds((prev) => new Set(prev).add(note.id))

          const timer = setTimeout(() => {
            newlyRenamedClearTimersRef.current.delete(timer)
            if (!isMountedRef.current) return

            setNewlyRenamedNodeIds((prev) => {
              const next = new Set(prev)
              next.delete(note.id)
              return next
            })
          }, 700)
          newlyRenamedClearTimersRef.current.add(timer)
        }
      }
    },
    [onRenameNode, t]
  )

  return {
    editingNodeId,
    renamingNodeIds,
    newlyRenamedNodeIds,
    inPlaceEdit,
    handleStartEdit,
    handleAutoRename,
    setEditingNodeId
  }
}
