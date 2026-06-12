import { Button, Field, FieldContent } from '@cherrystudio/ui'
import { getErrorMessage } from '@renderer/utils/error'
import { FolderOpen, FolderPlus, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from '../../FieldHeader'
import type { AgentFormState } from '../descriptor'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

const WorkspaceSection: FC<Props> = ({ form, onChange }) => {
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState(false)

  const hasValue = Boolean(form.workspacePath)
  const displayValue = form.workspacePath || t('library.config.agent.field.workspace.auto')
  const actionLabel = t(
    hasValue ? 'library.config.agent.field.workspace.change' : 'library.config.agent.field.workspace.select'
  )

  const handleSelect = async () => {
    if (selecting) return
    setSelecting(true)
    try {
      const selected = await window.api.file.selectFolder({
        title: t('library.config.agent.field.workspace.label'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (selected) {
        onChange({ workspacePath: selected })
      }
    } catch (error) {
      window.toast.error({
        title: t('agent.session.workspace.select_failed'),
        description: getErrorMessage(error)
      })
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.workspace.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.workspace.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.workspace.label')}
          hint={t('library.config.agent.field.workspace.hint')}
        />
        <FieldContent>
          <div className="rounded-md border border-border/30 bg-accent/15 p-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleSelect()}
                onMouseDown={(event) => event.stopPropagation()}
                disabled={selecting}
                loading={selecting}
                aria-label={actionLabel}
                className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-sm px-3 font-normal text-foreground text-xs shadow-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring/50">
                <span className="flex min-w-0 items-center gap-2">
                  {hasValue ? (
                    <FolderOpen size={15} className="shrink-0 text-primary" />
                  ) : (
                    <FolderPlus size={15} className="shrink-0 text-muted-foreground/80" />
                  )}
                  <span className="min-w-0 truncate text-left" title={form.workspacePath || undefined}>
                    {displayValue}
                  </span>
                </span>
                <span className="shrink-0 text-primary">{actionLabel}</span>
              </Button>
              {hasValue ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('library.config.agent.field.workspace.clear')}
                  onClick={() => onChange({ workspacePath: '' })}
                  className="flex size-8 min-h-0 shrink-0 items-center justify-center rounded-3xs font-normal text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring/50">
                  <X size={14} />
                </Button>
              ) : null}
            </div>
          </div>
        </FieldContent>
      </Field>
    </div>
  )
}

export default WorkspaceSection
