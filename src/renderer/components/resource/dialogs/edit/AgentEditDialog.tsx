import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EditableNumber,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TabsContent,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { normalizePermissionMode } from '@renderer/hooks/agents/permissionMode'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { useAgentMutations, useAgentMutationsById } from '@renderer/pages/library/adapters/agentAdapter'
import type { AgentDetail } from '@renderer/pages/library/types'
import {
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory,
  claudeUserFacingTools
} from '@shared/ai/claudecode/toolRegistry'
import type { AgentType } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from '../components/CatalogPicker'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent
} from '../form/agent'
import {
  AvatarField,
  CompactModelField,
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  type EditDialogBaseProps,
  EditDialogShell,
  type EditDialogTab,
  FieldLabelWithHelp,
  type ModelLabels,
  PromptVariablesPopover,
  TextInputField
} from './EditDialogShared'

export type AgentEditDialogProps = EditDialogBaseProps<AgentDetail> & {
  resource: AgentDetail | null
}

type AgentEditFormValues = {
  agentType: AgentType
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  planModelId: UniqueModelId | ''
  smallModelId: UniqueModelId | ''
  instructions: string
  mcps: string[]
  disabledTools: string[]
  permissionMode: string
  envVarsText: string
  soulEnabled: boolean
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

type ToolTab = 'tools.builtin' | 'tools.mcp' | 'tools.skills'
type CreateWizardStep = 'mode' | 'basic' | 'prompt' | 'tools'

const logger = loggerService.withContext('AgentEditDialog')
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const
const PERMISSION_MODE_LABEL_KEYS: Record<(typeof PERMISSION_MODES)[number], string> = {
  acceptEdits: 'library.config.agent.field.permission_mode.option.acceptEdits',
  bypassPermissions: 'library.config.agent.field.permission_mode.option.bypassPermissions',
  default: 'library.config.agent.field.permission_mode.option.default',
  plan: 'library.config.agent.field.permission_mode.option.plan'
}
const DEFAULT_TOOL_TAB: ToolTab = 'tools.builtin'
const CREATE_WIZARD_STEPS: CreateWizardStep[] = ['mode', 'basic', 'prompt', 'tools']

const CATEGORY_LABEL_KEYS: Record<ClaudeToolCategory, string> = {
  file: 'library.config.agent.section.tools.category.file',
  shell: 'library.config.agent.section.tools.category.shell',
  search: 'library.config.agent.section.tools.category.search',
  context: 'library.config.agent.section.tools.category.context',
  orchestration: 'library.config.agent.section.tools.category.orchestration',
  media: 'library.config.agent.section.tools.category.media'
}
const CATEGORY_LABEL_FALLBACKS: Record<ClaudeToolCategory, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  context: 'Context',
  orchestration: 'Orchestration',
  media: 'Media'
}

function isToolTab(value: string): value is ToolTab {
  return value === 'tools.builtin' || value === 'tools.mcp' || value === 'tools.skills'
}

function getLeafTabIds(tabs: EditDialogTab[]) {
  return tabs.flatMap((tab) => (tab.children?.length ? tab.children.map((child) => child.id) : [tab.id]))
}

function defaultValuesForAgent(resource: AgentDetail): AgentEditFormValues {
  const form = buildInitialAgentFormState(resource)
  return {
    agentType: form.type,
    avatar: form.avatar || '🤖',
    name: form.name,
    description: form.description,
    modelId: form.model || null,
    planModelId: form.planModel,
    smallModelId: form.smallModel,
    instructions: form.instructions,
    mcps: [...form.mcps],
    disabledTools: [...form.disabledTools],
    permissionMode: form.permissionMode,
    envVarsText: form.envVarsText,
    soulEnabled: form.soulEnabled,
    heartbeatEnabled: form.heartbeatEnabled,
    heartbeatInterval: form.heartbeatInterval
  }
}

function defaultValuesForAgentCreate(): AgentEditFormValues {
  const form = buildInitialAgentFormState(null)
  return {
    agentType: form.type,
    avatar: form.avatar || '🤖',
    name: form.name,
    description: form.description,
    modelId: form.model || null,
    planModelId: form.planModel,
    smallModelId: form.smallModel,
    instructions: form.instructions,
    mcps: [...form.mcps],
    disabledTools: [...form.disabledTools],
    permissionMode: form.permissionMode,
    envVarsText: form.envVarsText,
    soulEnabled: form.soulEnabled,
    heartbeatEnabled: form.heartbeatEnabled,
    heartbeatInterval: form.heartbeatInterval
  }
}

function modelLabelsForAgent(resource: AgentDetail): ModelLabels {
  return {
    modelId: resource.model ?? null,
    planModelId: resource.planModel ?? null,
    smallModelId: resource.smallModel ?? null
  }
}

function buildAgentFormState(baseline: AgentFormState, values: AgentEditFormValues): AgentFormState {
  return {
    ...baseline,
    type: values.agentType,
    avatar: values.avatar,
    name: values.name,
    description: values.description,
    model: values.modelId ?? '',
    planModel: values.planModelId || '',
    smallModel: values.smallModelId || '',
    instructions: values.instructions,
    mcps: values.mcps,
    disabledTools: values.disabledTools,
    permissionMode: values.permissionMode,
    envVarsText: values.envVarsText,
    soulEnabled: values.soulEnabled,
    heartbeatEnabled: values.heartbeatEnabled,
    heartbeatInterval: values.heartbeatInterval
  }
}

function syncAgentFormState(form: UseFormReturn<AgentEditFormValues>, next: AgentFormState) {
  form.setValue('agentType', next.type, { shouldDirty: true })
  form.setValue('modelId', next.model || null, { shouldDirty: true })
  form.setValue('planModelId', next.planModel, { shouldDirty: true })
  form.setValue('smallModelId', next.smallModel, { shouldDirty: true })
  form.setValue('mcps', next.mcps, { shouldDirty: true })
  form.setValue('disabledTools', next.disabledTools, { shouldDirty: true })
  form.setValue('permissionMode', next.permissionMode, { shouldDirty: true })
  form.setValue('soulEnabled', next.soulEnabled, { shouldDirty: true })
  form.setValue('heartbeatEnabled', next.heartbeatEnabled, { shouldDirty: true })
  form.setValue('heartbeatInterval', next.heartbeatInterval, { shouldDirty: true })
}

function createAgentPatcher(form: UseFormReturn<AgentEditFormValues>, resource: AgentDetail) {
  return (patch: Partial<AgentFormState>) => {
    const baseline = buildInitialAgentFormState(resource)
    const current = buildAgentFormState(baseline, form.getValues())
    syncAgentFormState(form, applyAgentFormPatch(current, patch))
  }
}

function createAgentDraftPatcher(form: UseFormReturn<AgentEditFormValues>) {
  return (patch: Partial<AgentFormState>) => {
    const baseline = buildInitialAgentFormState(null)
    const current = buildAgentFormState(baseline, form.getValues())
    syncAgentFormState(form, applyAgentFormPatch(current, patch))
  }
}

export function AgentEditDialog({ resource, open, onOpenChange, onSaved, modelFilter }: AgentEditDialogProps) {
  if (!resource) return null

  return (
    <AgentEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      modelFilter={modelFilter}
    />
  )
}

export type AgentCreateWizardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (resource: AgentDetail) => Promise<void> | void
  agentModelFilters?: Partial<Record<AgentType, (model: Model) => boolean>>
}

export function AgentCreateWizardDialog({
  open,
  onOpenChange,
  onCreated,
  agentModelFilters
}: AgentCreateWizardDialogProps) {
  const { t } = useTranslation()
  const [activeStep, setActiveStep] = useState<CreateWizardStep>('mode')
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>(DEFAULT_TOOL_TAB)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>({ modelId: null, planModelId: null, smallModelId: null })
  const defaultValues = useMemo(() => defaultValuesForAgentCreate(), [])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const agentType = form.watch('agentType')
  const watchedAvatar = form.watch('avatar')
  const watchedName = form.watch('name')
  const watchedDescription = form.watch('description')
  const watchedModelId = form.watch('modelId')
  const watchedInstructions = form.watch('instructions')
  const watchedMcps = form.watch('mcps')
  const watchedDisabledTools = form.watch('disabledTools')
  const watchedPermissionMode = form.watch('permissionMode')
  const watchedSoulEnabled = form.watch('soulEnabled')
  const { createAgent } = useAgentMutations()
  const patchAgentForm = useMemo(() => createAgentDraftPatcher(form), [form])
  const activeStepIndex = Math.max(0, CREATE_WIZARD_STEPS.indexOf(activeStep))
  const isFirstStep = activeStepIndex === 0
  const isLastStep = activeStepIndex === CREATE_WIZARD_STEPS.length - 1
  const modelFilter = agentModelFilters?.[agentType]
  const isSubmitting = form.formState.isSubmitting
  const rootError = form.formState.errors.root?.message
  const fakeAgent = useMemo(
    (): AgentDetail => ({
      id: '',
      type: agentType,
      name: watchedName,
      model: watchedModelId,
      modelName: null,
      description: watchedDescription,
      instructions: watchedInstructions,
      mcps: watchedMcps,
      disabledTools: watchedDisabledTools,
      configuration: {
        avatar: watchedAvatar,
        permission_mode: normalizePermissionMode(watchedPermissionMode),
        soul_enabled: watchedSoulEnabled
      },
      createdAt: '',
      orderKey: '',
      updatedAt: ''
    }),
    [
      agentType,
      watchedAvatar,
      watchedDescription,
      watchedDisabledTools,
      watchedInstructions,
      watchedMcps,
      watchedModelId,
      watchedName,
      watchedPermissionMode,
      watchedSoulEnabled
    ]
  )

  useEffect(() => {
    if (!open) return
    form.reset(defaultValues)
    form.clearErrors()
    setActiveStep('mode')
    setActiveToolTab(DEFAULT_TOOL_TAB)
    setEmojiPickerOpen(false)
    setModelLabels({ modelId: null, planModelId: null, smallModelId: null })
  }, [defaultValues, form, open])

  const goToStep = (index: number) => {
    const nextStep = CREATE_WIZARD_STEPS[index]
    if (nextStep) setActiveStep(nextStep)
  }

  const validateBasics = () => {
    const name = form.getValues('name').trim()
    const modelId = form.getValues('modelId')
    if (!name) {
      form.setError('name', { message: t('library.config.dialogs.create.name_required') })
    }
    if (!modelId) {
      form.setError('modelId', { message: t('library.config.dialogs.create.model_required') })
    }
    return Boolean(name && modelId)
  }

  const goNext = () => {
    form.clearErrors('root')
    if (activeStep === 'basic' && !validateBasics()) return
    goToStep(activeStepIndex + 1)
  }

  const handleClose = (nextOpen: boolean) => {
    if (isSubmitting) return
    onOpenChange(nextOpen)
  }

  const handleCreate = form.handleSubmit(async () => {
    form.clearErrors('root')
    if (!validateBasics()) {
      setActiveStep('basic')
      return
    }

    const baseline = buildInitialAgentFormState(null)
    const draft = buildAgentFormState(baseline, form.getValues())
    const intent = diffAgentSaveIntent(draft, baseline, null)
    if (!intent || intent.kind !== 'create') {
      form.setError('root', { message: t('library.config.dialogs.create.submit_failed') })
      return
    }

    let created: AgentDetail
    try {
      created = await createAgent(intent.payload)
    } catch (error) {
      logger.error('Failed to create agent from wizard', error as Error)
      form.setError('root', { message: t('library.config.dialogs.create.submit_failed') })
      return
    }

    onOpenChange(false)
    await onCreated(created)
  })

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!isSubmitting}
        className="flex h-[min(760px,calc(100vh-3rem))] min-h-[560px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}>
        <Form {...form}>
          <DialogHeader className="shrink-0 border-border/40 border-b px-5 py-4 text-left">
            <DialogTitle className="text-base text-foreground">
              {watchedName.trim() || t('library.config.agent.create_title')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/70 text-xs">
              {t(createWizardStepDescriptionKey(activeStep))}
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 border-border/40 border-b px-5 py-3">
            <div className="grid grid-cols-4 gap-2">
              {CREATE_WIZARD_STEPS.map((step, index) => {
                const Icon = createWizardStepIcon(step)
                const active = activeStep === step
                const completed = activeStepIndex > index
                return (
                  <button
                    key={step}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => goToStep(index)}
                    className={`flex min-h-[54px] flex-col items-start justify-center rounded-xs border px-3 text-left transition-colors ${
                      active
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : completed
                          ? 'border-border/40 bg-accent/25 text-foreground'
                          : 'border-border/30 bg-transparent text-muted-foreground/70 hover:bg-accent/20'
                    }`}>
                    <span className="mb-1 flex items-center gap-1.5 text-xs">
                      {completed ? <Check size={12} /> : <Icon size={12} />}
                      {t(createWizardStepLabelKey(step))}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground/70">
                      {t(createWizardStepDescriptionKey(step))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {activeStep === 'mode' ? (
              <AgentRuntimeModeFields
                disabled={isSubmitting}
                value={agentType}
                onChange={(type) => patchAgentForm({ type })}
              />
            ) : null}
            {activeStep === 'basic' ? (
              <AgentBasicFields
                form={form}
                modelFilter={modelFilter}
                portalContainer={dialogContentElement}
                modelLabels={modelLabels}
                setModelLabels={setModelLabels}
                patchAgentForm={patchAgentForm}
                emojiPickerOpen={emojiPickerOpen}
                setEmojiPickerOpen={setEmojiPickerOpen}
                variant="create"
              />
            ) : null}
            {activeStep === 'prompt' ? <AgentPromptField form={form} portalContainer={dialogContentElement} /> : null}
            {activeStep === 'tools' ? (
              <div className="grid gap-5">
                <CreateToolTabPicker value={activeToolTab} onChange={setActiveToolTab} />
                <AgentToolsFields
                  agent={fakeAgent}
                  form={form}
                  activeToolTab={activeToolTab}
                  portalContainer={dialogContentElement}
                />
                <CreateAdvancedSettings
                  form={form}
                  portalContainer={dialogContentElement}
                  patchAgentForm={patchAgentForm}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-border/40 border-t px-5 py-4">
            <div className="min-w-0 flex-1 text-left">
              {rootError ? <p className="truncate text-destructive text-xs">{rootError}</p> : null}
            </div>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep(activeStepIndex - 1)}
              disabled={isFirstStep || isSubmitting}>
              <ChevronLeft size={14} />
              {t('common.previous')}
            </Button>
            {isLastStep ? (
              <Button type="button" loading={isSubmitting} onClick={() => void handleCreate()}>
                <Check size={14} />
                {t('library.config.dialogs.create.submit')}
              </Button>
            ) : (
              <Button type="button" disabled={isSubmitting} onClick={goNext}>
                {t('common.next')}
                <ChevronRight size={14} />
              </Button>
            )}
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function createWizardStepLabelKey(step: CreateWizardStep): string {
  switch (step) {
    case 'mode':
      return 'library.config.dialogs.create.agent_mode.label'
    case 'basic':
      return 'library.config.agent.section.basic.label'
    case 'prompt':
      return 'library.config.agent.section.prompt.label'
    case 'tools':
      return 'library.config.agent.section.tools.label'
  }
}

function createWizardStepDescriptionKey(step: CreateWizardStep): string {
  switch (step) {
    case 'mode':
      return 'library.config.agent.section.mode.desc'
    case 'basic':
      return 'library.config.agent.section.basic.desc'
    case 'prompt':
      return 'library.config.agent.section.prompt.desc'
    case 'tools':
      return 'library.config.agent.section.tools.desc'
  }
}

function createWizardStepIcon(step: CreateWizardStep) {
  switch (step) {
    case 'mode':
      return Sparkles
    case 'basic':
      return Settings
    case 'prompt':
      return FileText
    case 'tools':
      return Wrench
  }
}

function AgentRuntimeModeFields({
  value,
  disabled,
  onChange
}: {
  value: AgentType
  disabled: boolean
  onChange: (value: AgentType) => void
}) {
  const { t } = useTranslation()
  const modes: Array<{
    type: AgentType
    icon: typeof Zap
    title: string
    description: string
  }> = [
    {
      type: 'pi',
      icon: Zap,
      title: t('library.config.dialogs.create.agent_mode.standard.title'),
      description: t('library.config.dialogs.create.agent_mode.standard.description')
    },
    {
      type: 'claude-code',
      icon: Sparkles,
      title: t('library.config.dialogs.create.agent_mode.enhanced.title'),
      description: t('library.config.dialogs.create.agent_mode.enhanced.description')
    }
  ]

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.dialogs.create.agent_mode.label')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.mode.desc')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {modes.map((mode) => {
          const Icon = mode.icon
          const active = value === mode.type
          return (
            <button
              key={mode.type}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(mode.type)}
              className={`min-h-[150px] rounded-md border p-5 text-left transition-colors ${
                active
                  ? 'border-primary/45 bg-primary/10 text-foreground'
                  : 'border-border/40 bg-background hover:bg-accent/25'
              }`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <span
                  className={`rounded-md p-2 ${active ? 'bg-primary/15 text-primary' : 'bg-accent text-muted-foreground'}`}>
                  <Icon size={18} />
                </span>
                {active ? <Check size={18} /> : null}
              </div>
              <div className="font-medium text-sm">{mode.title}</div>
              <p className="mt-2 text-muted-foreground/80 text-xs leading-5">{mode.description}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CreateToolTabPicker({ value, onChange }: { value: ToolTab; onChange: (value: ToolTab) => void }) {
  const { t } = useTranslation()
  const tabs: Array<{ id: ToolTab; label: string }> = [
    { id: 'tools.builtin', label: t('library.config.agent.section.tools.tab.tools') },
    { id: 'tools.mcp', label: t('library.config.agent.section.tools.tab.mcp') },
    { id: 'tools.skills', label: t('library.config.agent.section.tools.tab.skills') }
  ]

  return (
    <div className="flex w-fit rounded-md border border-border/40 bg-accent/20 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`h-8 rounded-sm px-3 text-sm transition-colors ${
            value === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function CreateAdvancedSettings({
  form,
  portalContainer,
  patchAgentForm
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()
  const soulEnabled = form.watch('soulEnabled')

  return (
    <details className="rounded-md border border-border/40 bg-accent/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium text-foreground text-sm [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal size={14} />
        {t('common.advanced_settings')}
      </summary>
      <div className="grid gap-4 border-border/30 border-t px-3 py-4">
        <SoulModeField form={form} patchAgentForm={patchAgentForm} />
        {!soulEnabled ? (
          <PermissionModeField form={form} portalContainer={portalContainer} patchAgentForm={patchAgentForm} />
        ) : null}
        <AgentAdvancedFields form={form} />
      </div>
    </details>
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  onSaved,
  modelFilter
}: EditDialogBaseProps<AgentDetail> & { resource: AgentDetail }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('basic')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAgent(resource))
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const values = form.watch()
  const patchAgentForm = useMemo(() => createAgentPatcher(form, resource), [form, resource])
  const { updateAgent } = useAgentMutationsById(resource.id)
  const saveIntent = useMemo(() => {
    const baseline = buildInitialAgentFormState(resource)
    return diffAgentSaveIntent(buildAgentFormState(baseline, values), baseline, resource)
  }, [resource, values])
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      {
        id: 'tools',
        label: t('library.config.dialogs.edit.tools_tab'),
        children: [
          { id: DEFAULT_TOOL_TAB, label: t('library.config.agent.section.tools.tab.tools') },
          { id: 'tools.mcp', label: t('library.config.agent.section.tools.tab.mcp') },
          { id: 'tools.skills', label: t('library.config.agent.section.tools.tab.skills') }
        ]
      },
      { id: 'advanced', label: t('library.config.dialogs.edit.advanced_tab') }
    ],
    [t]
  )
  const leafTabIds = useMemo(() => new Set(getLeafTabIds(tabs)), [tabs])

  useEffect(() => {
    if (!open) return

    form.reset(defaultValues)
    form.clearErrors()
    setActiveTab('basic')
    setEmojiPickerOpen(false)
    setModelLabels(modelLabelsForAgent(resource))
  }, [defaultValues, form, open, resource])

  useEffect(() => {
    if (leafTabIds.has(activeTab)) return
    setActiveTab('basic')
  }, [activeTab, leafTabIds])

  const isSubmitting = form.formState.isSubmitting
  const canSave = Boolean(saveIntent) && !isSubmitting
  const rootError = form.formState.errors.root?.message

  const handleSubmit = form.handleSubmit(async () => {
    const pending = saveIntent
    if (!pending) return

    form.clearErrors('root')

    let updated: Awaited<ReturnType<typeof updateAgent>>
    try {
      updated = await updateAgent(pending.payload)
    } catch (error) {
      logger.error('Failed to save agent edit dialog', error as Error, { agentId: resource.id })
      form.setError('root', { message: t('library.config.dialogs.edit.save_failed') })
      return
    }

    onOpenChange(false)
    try {
      await onSaved(updated)
    } catch (error) {
      logger.warn('Failed to run agent edit dialog post-save callback', { error, agentId: resource.id })
    }
  })

  return (
    <EditDialogShell
      activeTab={activeTab}
      canSave={canSave}
      form={form}
      isSubmitting={isSubmitting}
      onActiveTabChange={setActiveTab}
      onOpenChange={onOpenChange}
      onSubmit={handleSubmit}
      open={open}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}
      tabs={tabs}
      title={t('library.config.dialogs.edit.agent_title')}>
      <TabsContent value="basic" className="m-0">
        <AgentBasicFields
          form={form}
          modelFilter={modelFilter}
          portalContainer={dialogContentElement}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          patchAgentForm={patchAgentForm}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
        />
      </TabsContent>
      <TabsContent value="prompt" className="m-0">
        <AgentPromptField form={form} portalContainer={dialogContentElement} />
      </TabsContent>
      {isToolTab(activeTab) ? (
        <TabsContent value={activeTab} forceMount className="m-0">
          <AgentToolsFields
            agent={resource}
            form={form}
            activeToolTab={activeTab}
            portalContainer={dialogContentElement}
          />
        </TabsContent>
      ) : null}
      <TabsContent value="advanced" className="m-0">
        <AgentAdvancedFields form={form} />
      </TabsContent>
    </EditDialogShell>
  )
}

function AgentBasicFields({
  form,
  modelFilter,
  portalContainer,
  modelLabels,
  setModelLabels,
  patchAgentForm,
  emojiPickerOpen,
  setEmojiPickerOpen,
  variant = 'edit'
}: {
  form: UseFormReturn<AgentEditFormValues>
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  variant?: 'edit' | 'create'
}) {
  const { t } = useTranslation()
  const heartbeatEnabled = form.watch('heartbeatEnabled')
  const soulEnabled = form.watch('soulEnabled')
  const isCreate = variant === 'create'

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <AvatarField
          form={form}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
          fallback="🤖"
          portalContainer={portalContainer}
        />
        <TextInputField
          form={form}
          name="name"
          label={t('library.config.agent.field.name.label')}
          placeholder={t('library.config.agent.field.name.placeholder')}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <CompactModelField
          form={form}
          name="modelId"
          label={t('library.config.agent.field.model.label')}
          filter={modelFilter}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          onModelChange={(modelId) => patchAgentForm({ model: modelId ?? '' })}
        />
        {!isCreate ? (
          <>
            <CompactModelField
              form={form}
              name="planModelId"
              label={t('library.config.agent.field.plan_model.label')}
              allowClear
              filter={modelFilter}
              portalContainer={portalContainer}
              modelLabels={modelLabels}
              setModelLabels={setModelLabels}
              onModelChange={(modelId) => patchAgentForm({ planModel: modelId ?? '' })}
            />
            <CompactModelField
              form={form}
              name="smallModelId"
              label={t('library.config.agent.field.small_model.label')}
              allowClear
              filter={modelFilter}
              portalContainer={portalContainer}
              modelLabels={modelLabels}
              setModelLabels={setModelLabels}
              onModelChange={(modelId) => patchAgentForm({ smallModel: modelId ?? '' })}
            />
          </>
        ) : null}
      </div>
      <TextInputField
        form={form}
        name="description"
        label={t('library.config.agent.field.description.label')}
        placeholder={t('library.config.agent.field.description.placeholder')}
      />
      {!isCreate ? (
        <>
          <SoulModeField form={form} patchAgentForm={patchAgentForm} />
          {!soulEnabled && (
            <PermissionModeField form={form} portalContainer={portalContainer} patchAgentForm={patchAgentForm} />
          )}
          <HeartbeatSettingsField
            form={form}
            enabled={heartbeatEnabled}
            onEnabledChange={(checked) => patchAgentForm({ heartbeatEnabled: checked })}
          />
        </>
      ) : null}
    </div>
  )
}

function SoulModeField({
  form,
  patchAgentForm
}: {
  form: UseFormReturn<AgentEditFormValues>
  patchAgentForm: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()
  const label = t('library.config.agent.field.soul_enabled.label')

  return (
    <FormField
      control={form.control}
      name="soulEnabled"
      render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between gap-3">
            <FieldLabelWithHelp label={label} help={t('library.config.agent.field.soul_enabled.help')} />
            <Switch
              size="sm"
              checked={field.value}
              aria-label={label}
              onCheckedChange={(checked) => patchAgentForm({ soulEnabled: checked })}
            />
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function PermissionModeField({
  form,
  portalContainer,
  patchAgentForm
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name="permissionMode"
      render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between gap-3">
            <FormLabel>{t('library.config.agent.field.permission_mode.label')}</FormLabel>
            <Select
              value={field.value || 'default'}
              onValueChange={(value) => patchAgentForm({ permissionMode: value })}>
              <FormControl>
                <SelectTrigger
                  className="w-48 shrink-0"
                  aria-label={t('library.config.agent.field.permission_mode.label')}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent portalContainer={portalContainer}>
                {PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(PERMISSION_MODE_LABEL_KEYS[mode])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function HeartbeatSettingsField({
  form,
  enabled,
  onEnabledChange
}: {
  form: UseFormReturn<AgentEditFormValues>
  enabled: boolean
  onEnabledChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const label = t('library.config.agent.field.heartbeat_enabled.label')

  return (
    <div className="grid gap-2">
      <FormField
        control={form.control}
        name="heartbeatEnabled"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Switch size="sm" checked={field.value} onCheckedChange={onEnabledChange} aria-label={label} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {enabled ? (
        <FormField
          control={form.control}
          name="heartbeatInterval"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-3">
                <FormLabel>{t('library.config.agent.field.heartbeat_interval.label')}</FormLabel>
                <FormControl>
                  <EditableNumber
                    min={1}
                    max={1440}
                    step={1}
                    precision={0}
                    align="start"
                    changeOnBlur
                    className="w-28"
                    value={field.value || null}
                    onChange={(v) => field.onChange(typeof v === 'number' ? v : 0)}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  )
}

function AgentPromptField({
  form,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name="instructions"
      render={({ field }) => (
        <PromptEditorField
          label={
            <FieldLabelWithHelp
              label={t('library.config.agent.field.instructions.label')}
              helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
              formLabel={false}
            />
          }
          value={field.value}
          onChange={field.onChange}
          placeholder={t('library.config.agent.field.instructions.placeholder')}
          minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
          maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
        />
      )}
    />
  )
}

function AgentToolsFields({
  agent,
  form,
  activeToolTab,
  portalContainer
}: {
  agent: AgentDetail
  form: UseFormReturn<AgentEditFormValues>
  activeToolTab: ToolTab
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const disabledTools = form.watch('disabledTools')
  const mcps = form.watch('mcps')
  const canManageSkills = Boolean(agent.id)

  // Built-in catalog: registry user-facing tools grouped into category sections.
  // The toggle is a real enable/disable that writes the opt-out `disabledTools` set
  // (empty = all enabled); approval is governed solely by the permission-mode cards.
  const disabledSet = useMemo(() => new Set(disabledTools), [disabledTools])
  const builtinSections = useMemo(() => {
    const tools = claudeUserFacingTools()
    return CLAUDE_TOOL_CATEGORIES.map((category) => ({
      category,
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: tools
        .filter((tool) => tool.category === category)
        .map<CatalogItem>((tool) => ({
          id: tool.name,
          name: t(`agent.tools.builtin.${tool.key}.label`, tool.label),
          description: t(`agent.tools.builtin.${tool.key}.description`, tool.description),
          icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />
        }))
    })).filter((section) => section.items.length > 0)
  }, [t])
  const enabledToolIds = useMemo<ReadonlySet<string>>(
    () => new Set(builtinSections.flatMap((s) => s.items.map((i) => i.id)).filter((id) => !disabledSet.has(id))),
    [builtinSections, disabledSet]
  )
  const setToolEnabled = (name: string, enabled: boolean) =>
    form.setValue('disabledTools', enabled ? disabledTools.filter((n) => n !== name) : [...disabledTools, name], {
      shouldDirty: true
    })

  const mcpIds = useMemo(() => new Set(mcps), [mcps])
  const enableMCP = (id: string) => form.setValue('mcps', [...mcps, id], { shouldDirty: true })
  const disableMCP = (id: string) =>
    form.setValue(
      'mcps',
      mcps.filter((mcpId) => mcpId !== id),
      { shouldDirty: true }
    )

  const { skills, loading: skillsLoading, toggle: toggleSkill } = useInstalledSkills(agent.id || undefined)
  const skillCatalog = useMemo<CatalogItem[]>(
    () =>
      skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        icon: <Sparkles size={13} strokeWidth={1.5} className="text-amber-500/60" />
      })),
    [skills]
  )
  const enabledSkillIds = useMemo(
    () => new Set(skills.filter((skill) => skill.isEnabled).map((skill) => skill.id)),
    [skills]
  )
  const flipSkill = async (id: string, nextEnabled: boolean) => {
    try {
      await toggleSkill(id, nextEnabled)
    } catch {
      // useInstalledSkills owns toast/logging for toggle failures.
    }
  }

  return (
    <div className="grid gap-4">
      {activeToolTab === 'tools.builtin' ? (
        <div className="grid gap-5">
          {builtinSections.map((section) => (
            <div key={section.category} className="grid gap-2">
              <div className="font-medium text-foreground/55 text-xs">{section.label}</div>
              <CatalogToggleGrid
                items={section.items}
                enabledIds={enabledToolIds}
                onToggle={setToolEnabled}
                emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
                portalContainer={portalContainer}
              />
            </div>
          ))}
        </div>
      ) : null}
      {activeToolTab === 'tools.mcp' ? (
        <McpServerCatalogGrid
          title={t('library.config.tools.added')}
          enabledIds={mcpIds}
          onToggle={(id, enabled) => (enabled ? enableMCP(id) : disableMCP(id))}
          emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
          portalContainer={portalContainer}
        />
      ) : null}
      {activeToolTab === 'tools.skills' ? (
        <CatalogToggleGrid
          items={skillCatalog}
          enabledIds={enabledSkillIds}
          loading={skillsLoading}
          disabled={!canManageSkills}
          onToggle={flipSkill}
          emptyLabel={
            canManageSkills
              ? t('library.config.agent.section.tools.no_skills_enabled')
              : t('library.config.agent.section.tools.skills_require_save')
          }
          portalContainer={portalContainer}
        />
      ) : null}
    </div>
  )
}

function AgentAdvancedFields({ form }: { form: UseFormReturn<AgentEditFormValues> }) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="envVarsText"
        render={({ field }) => (
          <FormItem>
            <FieldLabelWithHelp
              label={t('library.config.agent.field.env_vars.label')}
              help={t('library.config.agent.field.env_vars.help')}
            />
            <FormControl>
              <Textarea.Input
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('library.config.agent.field.env_vars.placeholder')}
                rows={5}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
