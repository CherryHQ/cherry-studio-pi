import { loggerService } from '@logger'
import { type AssistantsState, hydrateAssistantsState } from '@renderer/store/assistants'
import { type BackupState, hydrateBackupState } from '@renderer/store/backup'
import { type CodeToolsState, hydrateCodeToolsState } from '@renderer/store/codeTools'
import { type CopilotState, hydrateCopilotState } from '@renderer/store/copilot'
import { hydrateInputToolsState, type InputToolsState } from '@renderer/store/inputTools'
import { hydrateKnowledgeState, type KnowledgeState } from '@renderer/store/knowledge'
import { hydrateLlmState, type LlmState } from '@renderer/store/llm'
import { hydrateMcpState } from '@renderer/store/mcp'
import { hydrateMemoryState, type MemoryState } from '@renderer/store/memory'
import { hydrateMinAppsState, type MinAppsState } from '@renderer/store/minapps'
import { hydrateNoteState, type NoteState } from '@renderer/store/note'
import { hydrateNutstoreState, type NutstoreState } from '@renderer/store/nutstore'
import { hydrateOcrState, type OcrState } from '@renderer/store/ocr'
import { hydrateOpenClawState, type OpenClawState } from '@renderer/store/openclaw'
import { hydratePaintingsState } from '@renderer/store/paintings'
import { hydratePreprocessState, type PreprocessState } from '@renderer/store/preprocess'
import { hydrateSelectionState } from '@renderer/store/selectionStore'
import { hydrateSettingsState, type SettingsState } from '@renderer/store/settings'
import { hydrateShortcutsState, type ShortcutsState } from '@renderer/store/shortcuts'
import { hydrateTranslateState, type TranslateState } from '@renderer/store/translate'
import { hydrateWebSearchState, type WebSearchState } from '@renderer/store/websearch'
import type { MCPConfig, PaintingsState } from '@renderer/types'
import type { SelectionState } from '@renderer/types/selectionTypes'

import { applyStorageV2LocalStorageSnapshot, type StorageV2LocalStorageSnapshot } from './StorageV2LocalStorageSnapshot'
import { getStorageV2CoreSnapshot } from './StorageV2Service'

const logger = loggerService.withContext('StorageV2HydrationService')
const AUTO_HYDRATE_SETTING_KEY = 'storage_v2.runtime.auto_hydrate'

type RuntimeHydrationTarget = {
  dispatch: (
    action:
      | ReturnType<typeof hydrateAssistantsState>
      | ReturnType<typeof hydrateBackupState>
      | ReturnType<typeof hydrateCodeToolsState>
      | ReturnType<typeof hydrateCopilotState>
      | ReturnType<typeof hydrateInputToolsState>
      | ReturnType<typeof hydrateKnowledgeState>
      | ReturnType<typeof hydrateLlmState>
      | ReturnType<typeof hydrateMemoryState>
      | ReturnType<typeof hydrateMinAppsState>
      | ReturnType<typeof hydrateMcpState>
      | ReturnType<typeof hydrateNoteState>
      | ReturnType<typeof hydrateNutstoreState>
      | ReturnType<typeof hydrateOcrState>
      | ReturnType<typeof hydrateOpenClawState>
      | ReturnType<typeof hydratePaintingsState>
      | ReturnType<typeof hydratePreprocessState>
      | ReturnType<typeof hydrateSelectionState>
      | ReturnType<typeof hydrateSettingsState>
      | ReturnType<typeof hydrateShortcutsState>
      | ReturnType<typeof hydrateTranslateState>
      | ReturnType<typeof hydrateWebSearchState>
  ) => unknown
  flush?: () => Promise<unknown>
}

type StorageV2CoreSnapshot = {
  generatedAt: string
  settings?: Partial<SettingsState>
  llm?: Partial<LlmState>
  assistants?: Partial<AssistantsState>
  redux?: {
    backup?: Partial<BackupState>
    codeTools?: Partial<CodeToolsState>
    copilot?: Partial<CopilotState>
    inputTools?: Partial<InputToolsState>
    knowledge?: Partial<KnowledgeState>
    memory?: Partial<MemoryState>
    minApps?: Partial<MinAppsState>
    mcp?: Partial<MCPConfig>
    note?: Partial<NoteState>
    nutstore?: Partial<NutstoreState>
    ocr?: Partial<OcrState>
    openclaw?: Partial<OpenClawState>
    paintings?: Partial<PaintingsState>
    preprocess?: Partial<PreprocessState>
    selectionStore?: Partial<SelectionState>
    shortcuts?: Partial<ShortcutsState>
    translate?: Partial<TranslateState>
    websearch?: Partial<WebSearchState>
  }
  localStorage?: Partial<StorageV2LocalStorageSnapshot>
  metadata?: {
    includeSecrets?: boolean
    settingCount?: number
    providerCount?: number
    assistantCount?: number
    topicCount?: number
    reduxSliceCount?: number
    missingSecretCount?: number
  }
}

type AutoHydrateResult =
  | {
      hydrated: true
      snapshot: StorageV2CoreSnapshot
    }
  | {
      hydrated: false
      reason: 'disabled' | 'empty'
    }

function parseAutoHydrateSetting(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object' && 'enabled' in value) {
    return (value as { enabled?: unknown }).enabled === true
  }
  return false
}

function hasMeaningfulSnapshotValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasMeaningfulSnapshotValue)
  }
  return true
}

function hasMeaningfulLocalStorageSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<StorageV2LocalStorageSnapshot>

  return hasMeaningfulSnapshotValue(snapshot.durableValues) || hasMeaningfulSnapshotValue(snapshot.mcpProviderTokens)
}

function hasCoreData(snapshot: StorageV2CoreSnapshot): boolean {
  const metadata = snapshot.metadata ?? {}
  return (
    Number(metadata.providerCount ?? 0) > 0 ||
    Number(metadata.assistantCount ?? 0) > 0 ||
    Number(metadata.topicCount ?? 0) > 0 ||
    Number(metadata.reduxSliceCount ?? 0) > 0 ||
    hasMeaningfulSnapshotValue(snapshot.settings) ||
    hasMeaningfulSnapshotValue(snapshot.llm) ||
    hasMeaningfulSnapshotValue(snapshot.assistants) ||
    hasMeaningfulSnapshotValue(snapshot.redux) ||
    hasMeaningfulLocalStorageSnapshot(snapshot.localStorage)
  )
}

async function getRuntimeSnapshot() {
  const snapshot = (await getStorageV2CoreSnapshot({ includeSecrets: true })) as StorageV2CoreSnapshot

  if (!hasCoreData(snapshot)) {
    throw new Error('Storage v2 has no core runtime data to restore.')
  }

  return snapshot
}

async function applyRuntimeSnapshot(snapshot: StorageV2CoreSnapshot, target: RuntimeHydrationTarget) {
  if (snapshot.settings) {
    target.dispatch(hydrateSettingsState(snapshot.settings))
    if (typeof snapshot.settings.language === 'string' && typeof localStorage !== 'undefined') {
      localStorage.setItem('language', snapshot.settings.language)
    }
  }

  if (snapshot.llm) {
    target.dispatch(hydrateLlmState(snapshot.llm))
  }

  if (snapshot.assistants) {
    target.dispatch(hydrateAssistantsState(snapshot.assistants))
  }

  if (snapshot.redux?.backup) {
    target.dispatch(hydrateBackupState(snapshot.redux.backup))
  }

  if (snapshot.redux?.codeTools) {
    target.dispatch(hydrateCodeToolsState(snapshot.redux.codeTools))
  }

  if (snapshot.redux?.copilot) {
    target.dispatch(hydrateCopilotState(snapshot.redux.copilot))
  }

  if (snapshot.redux?.inputTools) {
    target.dispatch(hydrateInputToolsState(snapshot.redux.inputTools))
  }

  if (snapshot.redux?.knowledge) {
    target.dispatch(hydrateKnowledgeState(snapshot.redux.knowledge))
  }

  if (snapshot.redux?.memory) {
    target.dispatch(hydrateMemoryState(snapshot.redux.memory))
  }

  if (snapshot.redux?.minApps) {
    target.dispatch(hydrateMinAppsState(snapshot.redux.minApps))
  }

  if (snapshot.redux?.mcp) {
    target.dispatch(hydrateMcpState(snapshot.redux.mcp))
  }

  if (snapshot.redux?.note) {
    target.dispatch(hydrateNoteState(snapshot.redux.note))
  }

  if (snapshot.redux?.nutstore) {
    target.dispatch(hydrateNutstoreState(snapshot.redux.nutstore))
  }

  if (snapshot.redux?.ocr) {
    target.dispatch(hydrateOcrState(snapshot.redux.ocr))
  }

  if (snapshot.redux?.openclaw) {
    target.dispatch(hydrateOpenClawState(snapshot.redux.openclaw))
  }

  if (snapshot.redux?.paintings) {
    target.dispatch(hydratePaintingsState(snapshot.redux.paintings))
  }

  if (snapshot.redux?.preprocess) {
    target.dispatch(hydratePreprocessState(snapshot.redux.preprocess))
  }

  if (snapshot.redux?.selectionStore) {
    target.dispatch(hydrateSelectionState(snapshot.redux.selectionStore))
  }

  if (snapshot.redux?.shortcuts) {
    target.dispatch(hydrateShortcutsState(snapshot.redux.shortcuts))
  }

  if (snapshot.redux?.translate) {
    target.dispatch(hydrateTranslateState(snapshot.redux.translate))
  }

  if (snapshot.redux?.websearch) {
    target.dispatch(hydrateWebSearchState(snapshot.redux.websearch))
  }

  if (snapshot.localStorage) {
    applyStorageV2LocalStorageSnapshot(snapshot.localStorage)
  }

  await target.flush?.()
}

export async function getStorageV2AutoHydrateEnabled(): Promise<boolean> {
  const value = await window.api.storageV2.getSetting(AUTO_HYDRATE_SETTING_KEY)
  return parseAutoHydrateSetting(value)
}

export async function setStorageV2AutoHydrateEnabled(enabled: boolean): Promise<boolean> {
  await window.api.storageV2.setSetting(
    AUTO_HYDRATE_SETTING_KEY,
    {
      enabled,
      updatedAt: new Date().toISOString()
    },
    'storage-v2'
  )
  return enabled
}

export async function hydrateRuntimeCacheFromStorageV2(target: RuntimeHydrationTarget): Promise<StorageV2CoreSnapshot> {
  const snapshot = await getRuntimeSnapshot()

  await applyRuntimeSnapshot(snapshot, target)
  logger.info('Hydrated runtime cache from Storage v2', snapshot.metadata ?? {})

  return snapshot
}

export async function maybeHydrateRuntimeCacheFromStorageV2(
  target: RuntimeHydrationTarget
): Promise<AutoHydrateResult> {
  if (!(await getStorageV2AutoHydrateEnabled())) {
    return {
      hydrated: false,
      reason: 'disabled'
    }
  }

  const snapshot = (await getStorageV2CoreSnapshot({ includeSecrets: true })) as StorageV2CoreSnapshot
  if (!hasCoreData(snapshot)) {
    return {
      hydrated: false,
      reason: 'empty'
    }
  }

  await applyRuntimeSnapshot(snapshot, target)
  logger.info('Auto hydrated runtime cache from Storage v2', snapshot.metadata ?? {})

  return {
    hydrated: true,
    snapshot
  }
}
