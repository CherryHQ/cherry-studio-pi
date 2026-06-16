import { Button, Field, FieldContent, FieldDescription, FieldError, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector/types'
import { useModels } from '@renderer/hooks/useModel'
import {
  isUniqueModelId,
  type Model,
  parseUniqueModelId,
  UNIQUE_MODEL_ID_SEPARATOR,
  type UniqueModelId
} from '@shared/data/types/model'
import { ChevronsUpDown, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from './FieldHeader'

interface Props {
  label: string
  hint?: string
  value?: string | null
  allowClear?: boolean
  errorMessage?: string
  filter?: ModelSelectorFilter
  onSelect: (modelId: UniqueModelId | null, model?: Model) => void
}

function getModelProviderId(model: Model): string | undefined {
  const providerId = typeof model.providerId === 'string' ? model.providerId.trim() : ''
  if (providerId) return providerId
  return isUniqueModelId(model.id) ? parseUniqueModelId(model.id).providerId : undefined
}

function getModelRawId(model: Model): string {
  const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : ''
  if (apiModelId) return apiModelId
  return isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : model.id
}

export function buildModelsById(models: readonly Model[]): Map<string, Model> {
  const modelsById = new Map<string, Model>()

  for (const model of models) {
    modelsById.set(model.id, model)
  }

  for (const model of models) {
    const providerId = getModelProviderId(model)
    const rawModelId = getModelRawId(model).trim()
    if (!providerId || !rawModelId) continue

    const apiAliasId = `${providerId}${UNIQUE_MODEL_ID_SEPARATOR}${rawModelId}`
    if (!modelsById.has(apiAliasId)) {
      modelsById.set(apiAliasId, model)
    }
  }

  return modelsById
}

export function ModelSelectorField({ label, hint, value, allowClear = false, errorMessage, filter, onSelect }: Props) {
  const { t } = useTranslation()
  const { models } = useModels({ enabled: true })
  const modelsById = useMemo(() => buildModelsById(models), [models])
  const selectorValue = value && isUniqueModelId(value) ? value : undefined
  const selectedModel = selectorValue ? modelsById.get(selectorValue) : undefined
  const hasValue = Boolean(value)
  const invalid = Boolean(errorMessage)
  const triggerLabel = selectedModel?.name ?? (value || t('library.config.basic.model_pick'))

  const handleSelect = (modelId: UniqueModelId | undefined) => {
    onSelect(modelId ?? null, modelId ? modelsById.get(modelId) : undefined)
  }

  return (
    <Field data-invalid={invalid || undefined} className="gap-1.5">
      <FieldHeader label={label} hint={hint} />
      <FieldContent>
        <div
          className={cn(
            'rounded-md border bg-accent/15 transition-colors',
            invalid ? 'border-destructive/50' : 'border-border/20'
          )}>
          <div className="flex items-center gap-1.5 px-2 py-1">
            <ModelSelector
              multiple={false}
              selectionType="id"
              value={selectorValue}
              filter={filter}
              listVisibleCount={8}
              onSelect={handleSelect}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-auto min-h-0 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-sm px-2 py-1 font-normal text-foreground text-xs shadow-none hover:bg-accent/50 focus-visible:ring-0">
                  <span className="min-w-0 truncate text-left">{triggerLabel}</span>
                  <ChevronsUpDown size={12} className="shrink-0 text-muted-foreground/80" />
                </Button>
              }
            />
            {allowClear && hasValue ? (
              <Tooltip content={t('library.config.basic.model_clear')}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${label} ${t('library.config.basic.model_clear')}`}
                  onClick={() => onSelect(null)}
                  className="flex h-6 min-h-0 w-6 shrink-0 items-center justify-center rounded-3xs font-normal text-muted-foreground/80 shadow-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0">
                  <Trash2 size={12} />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <FieldError className="text-xs" errors={errorMessage ? [{ message: errorMessage }] : undefined} />
        {hasValue && !selectedModel ? (
          <FieldDescription className="text-muted-foreground/80 text-xs">
            {t('library.config.basic.model_not_found', { id: value })}
          </FieldDescription>
        ) : null}
      </FieldContent>
    </Field>
  )
}
