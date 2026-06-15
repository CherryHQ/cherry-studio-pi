import { Button, DialogHeader, DialogTitle, Switch } from '@cherrystudio/ui'
import { cacheService } from '@renderer/data/CacheService'
import { useAgentTools } from '@renderer/hooks/agents/useAgentTools'
import { Check, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentCreateCompanionMutations, useAgentMutations, useAgentMutationsById } from '../../adapters/agentAdapter'
import type { AgentDetail } from '../../types'
import { ConfigEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'
import {
  AGENT_CONFIG_SECTIONS,
  type AgentConfigSection,
  type AgentFormState,
  type AgentSaveIntent,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  validateAgentCreateForm
} from './descriptor'
import AdvancedSection from './sections/AdvancedSection'
import BasicSection from './sections/BasicSection'
import ModeSection from './sections/ModeSection'
import PermissionSection from './sections/PermissionSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'
import WorkspaceSection from './sections/WorkspaceSection'

interface Props {
  /**
   * `undefined` puts the page in **create mode**: the agent row is not
   * POSTed until the user clicks 保存. Pass an `AgentDetail` for **edit
   * mode** — saves PATCH the existing row.
   */
  agent?: AgentDetail
  onBack: () => void
  /**
   * Called once the create flow lands a new agent on the server so the
   * parent can return to list mode and refetch the latest collection.
   */
  onCreated?: (created: AgentDetail) => void
  presentation?: 'page' | 'dialog'
}

const CREATE_AGENT_STEP_IDS: AgentConfigSection[] = ['mode', 'basic', 'workspace', 'prompt', 'tools']

// Stub used by the Tools tab in create mode so `agent.id` reads are safe.
// Skills still require a persisted agent id; tool and MCP draft changes are
// saved with the create payload.
const EMPTY_AGENT_FOR_CREATE: AgentDetail = {
  id: '',
  type: 'pi',
  name: '',
  model: null,
  modelName: null,
  createdAt: '',
  updatedAt: ''
}

/**
 * Agent editor — same shell in both create and edit flows.
 *
 * - **Create** (library "+ Agent" → this page with `agent` undefined):
 *   form starts empty, Save POSTs a `CreateAgentDto` built by the
 *   descriptor, then fires `onCreated` so the parent can return to the
 *   list and fetch the canonical row set.
 * - **Edit** (`agent` present): Save PATCHes only the field diff.
 *   `configuration` sub-keys are merged onto the existing
 *   configuration rather than replacing it.
 *
 * Both flows share the generic `useResourceEditorState` hook + the
 * shared `ConfigEditorShell`; the create-vs-update branch lives in
 * `onCommit` and the `AgentSaveIntent` discriminant returned by
 * `diffAgentSaveIntent`.
 */
const AgentConfigPage: FC<Props> = ({ agent, onBack, onCreated, presentation = 'page' }) => {
  const { t } = useTranslation()
  const isCreate = !agent
  const isDialogCreate = isCreate && presentation === 'dialog'

  const [currentAgent, setCurrentAgent] = useState<AgentDetail | undefined>(undefined)
  const [activeSection, setActiveSection] = useState<AgentConfigSection>(isCreate ? 'mode' : 'basic')

  const editAgent = currentAgent && agent && currentAgent.id === agent.id ? currentAgent : agent

  const { createAgent } = useAgentMutations()
  const { createWorkspaceByPath, createInitialSession } = useAgentCreateCompanionMutations()
  // Safe empty-string id in create mode — `useMutation` builds the path at
  // call-time and we only invoke the edit mutations in edit mode.
  const { updateAgent } = useAgentMutationsById(editAgent?.id ?? '')

  const initialForm = useMemo(() => buildInitialAgentFormState(editAgent), [editAgent])

  const { form, setForm, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    AgentFormState,
    AgentSaveIntent
  >({
    initialForm,
    baselineKey: agent?.id ?? null,
    diff: (nextForm, baseline) => diffAgentSaveIntent(nextForm, baseline, editAgent ?? null),
    onCommit: async (intent) => {
      if (intent.kind === 'create') {
        const workspacePath = form.workspacePath.trim()
        const workspace = workspacePath ? await createWorkspaceByPath(workspacePath) : undefined
        if (workspacePath && !workspace) {
          throw new Error(t('agent.session.workspace.create_failed'))
        }
        const created = await createAgent(intent.payload)
        const initialSession = await createInitialSession({
          agentId: created.id,
          name: t('common.unnamed'),
          ...(workspace ? { workspaceId: workspace.id } : {})
        })
        cacheService.set('agent.active_session_id', initialSession.id)
        onCreated?.(created)
        // Even though the page returns to the list right after create, keep
        // the canonical row here so the save state machine completes against
        // backend-normalized data before the parent unmounts this editor.
        const next = buildInitialAgentFormState(created)
        return { nextBaseline: next, nextForm: next }
      }
      const updated = await updateAgent(intent.payload)
      setCurrentAgent(updated)
      const next = buildInitialAgentFormState(updated)
      return { nextBaseline: next, nextForm: next }
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })
  const runtimeType = isCreate ? form.type : (editAgent?.type ?? form.type)
  const { tools } = useAgentTools({
    type: runtimeType,
    mcps: form.mcps,
    allowedTools: form.allowedTools,
    permissionMode: form.permissionMode
  })
  const onChange = useCallback(
    (patch: Partial<AgentFormState>) => {
      if (patch.soulEnabled === true && activeSection === 'permission') {
        setActiveSection('basic')
      }
      setForm((prev) => applyAgentFormPatch(prev, patch, tools))
    },
    [activeSection, setForm, tools]
  )
  const visibleSections = useMemo(
    () =>
      AGENT_CONFIG_SECTIONS.filter(
        (section) =>
          (isCreate || section.id !== 'mode') &&
          (isCreate || section.id !== 'workspace') &&
          (!form.soulEnabled || section.id !== 'permission')
      ),
    [form.soulEnabled, isCreate]
  )

  const title = isCreate
    ? form.name.trim() || t('library.config.agent.create_title')
    : form.name || editAgent?.name || editAgent?.id || ''
  const requiredFieldMessage = t('common.required_field')
  const createValidation = isCreate ? validateAgentCreateForm(form) : null
  const createSteps = useMemo(
    () => AGENT_CONFIG_SECTIONS.filter((section) => CREATE_AGENT_STEP_IDS.includes(section.id)),
    []
  )
  const activeCreateStepIndex = Math.max(
    0,
    createSteps.findIndex((section) => section.id === activeSection)
  )
  const isFirstCreateStep = activeCreateStepIndex <= 0
  const isLastCreateStep = activeCreateStepIndex >= createSteps.length - 1
  const activeCreateStep = createSteps[activeCreateStepIndex] ?? createSteps[0]

  const renderSection = (sectionId: AgentConfigSection) => (
    <>
      {sectionId === 'mode' && isCreate && <ModeSection form={form} onChange={onChange} />}
      {sectionId === 'basic' && (
        <BasicSection
          form={form}
          onChange={onChange}
          variant={isCreate ? 'create' : 'full'}
          nameError={createValidation?.nameMissing ? requiredFieldMessage : undefined}
          modelError={createValidation?.modelMissing ? requiredFieldMessage : undefined}
        />
      )}
      {sectionId === 'workspace' && isCreate && <WorkspaceSection form={form} onChange={onChange} />}
      {sectionId === 'prompt' && <PromptSection form={form} onChange={onChange} />}
      {sectionId === 'permission' && !form.soulEnabled && <PermissionSection form={form} onChange={onChange} />}
      {sectionId === 'tools' && (
        <>
          <ToolsSection
            agent={editAgent ?? { ...EMPTY_AGENT_FOR_CREATE, type: runtimeType }}
            tools={tools}
            form={form}
            onChange={onChange}
          />
          {isDialogCreate ? <CreateAdvancedSettings form={form} onChange={onChange} /> : null}
        </>
      )}
      {sectionId === 'advanced' && <AdvancedSection form={form} onChange={onChange} />}
    </>
  )

  if (isDialogCreate) {
    const goToCreateStep = (index: number) => {
      const nextSection = createSteps[index]
      if (nextSection) setActiveSection(nextSection.id)
    }

    const goNext = () => {
      if (activeCreateStep.id === 'basic' && createValidation && !createValidation.isValid) {
        return
      }
      goToCreateStep(activeCreateStepIndex + 1)
    }

    return (
      <div className="flex max-h-[min(760px,calc(100vh-3rem))] min-h-[560px] flex-col overflow-hidden bg-background">
        <DialogHeader className="shrink-0 border-border/40 border-b px-5 py-4 text-left">
          <DialogTitle className="text-base text-foreground">
            {form.name.trim() || t('library.config.agent.create_title')}
          </DialogTitle>
          <p className="text-muted-foreground/70 text-xs">{t(activeCreateStep.descKey)}</p>
        </DialogHeader>

        <div className="shrink-0 border-border/40 border-b px-5 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {createSteps.map((section, index) => {
              const Icon = section.icon
              const active = activeCreateStepIndex === index
              const completed = activeCreateStepIndex > index
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => goToCreateStep(index)}
                  className={`flex min-h-[54px] flex-col items-start justify-center rounded-xs border px-3 text-left transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : completed
                        ? 'border-border/40 bg-accent/25 text-foreground'
                        : 'border-border/30 bg-transparent text-muted-foreground/70 hover:bg-accent/20'
                  }`}>
                  <span className="mb-1 flex items-center gap-1.5 text-xs">
                    {completed ? <Check size={12} /> : <Icon size={12} />}
                    {t(section.labelKey)}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground/70">{t(section.descKey)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{renderSection(activeCreateStep.id)}</div>

        <div className="flex shrink-0 items-center gap-3 border-border/40 border-t px-5 py-4">
          <div className="min-w-0 flex-1">
            {error ? <p className="truncate text-destructive text-xs">{error}</p> : null}
            {saved ? <p className="text-muted-foreground/70 text-xs">{t('common.saved')}</p> : null}
          </div>
          <Button variant="ghost" onClick={onBack} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => goToCreateStep(activeCreateStepIndex - 1)}
            disabled={isFirstCreateStep || saving}>
            <ChevronLeft size={14} />
            {t('common.previous')}
          </Button>
          {isLastCreateStep ? (
            <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
              <Check size={14} />
              {saving ? t('library.config.saving') : t('library.config.agent.create_title')}
            </Button>
          ) : (
            <Button onClick={goNext} disabled={saving}>
              {t('common.next')}
              <ChevronRight size={14} />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <ConfigEditorShell<AgentConfigSection>
      title={title}
      sections={visibleSections}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      contentWidth="wide"
      canSave={canSave}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      onBack={onBack}
      topBanner={isCreate ? <CreateAgentBanner /> : undefined}>
      {renderSection(activeSection)}
    </ConfigEditorShell>
  )
}

export default AgentConfigPage

/**
 * Inline banner shown above the shell body while the agent doesn't yet exist
 * server-side: skills cannot be enabled until an agent id has been assigned.
 */
function CreateAgentBanner() {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-2 border-border/40 border-b bg-accent/20 px-5 py-2 text-muted-foreground/70 text-xs">
      <span>{t('library.config.agent.section.tools.skills_require_save')}</span>
    </div>
  )
}

function CreateAdvancedSettings({
  form,
  onChange
}: {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()

  return (
    <details className="mt-5 rounded-xs border border-border/40 bg-accent/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium text-foreground text-sm [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal size={14} />
        {t('common.advanced_settings')}
      </summary>
      <div className="flex flex-col gap-5 border-border/30 border-t px-3 py-4">
        <div className="rounded-xs border border-border/30 bg-background/70 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-foreground text-sm">{t('library.config.agent.field.soul_enabled.label')}</p>
              <p className="mt-0.5 text-muted-foreground/70 text-xs">
                {t('library.config.agent.field.soul_enabled.help')}
              </p>
            </div>
            <Switch
              size="sm"
              checked={form.soulEnabled}
              onCheckedChange={(checked) => onChange({ soulEnabled: checked })}
              aria-label={t('library.config.agent.field.soul_enabled.label')}
            />
          </div>
        </div>

        {!form.soulEnabled ? <PermissionSection form={form} onChange={onChange} /> : null}
        <AdvancedSection form={form} onChange={onChange} />
      </div>
    </details>
  )
}
