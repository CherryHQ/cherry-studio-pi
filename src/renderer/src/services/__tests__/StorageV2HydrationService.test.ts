import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStorageV2CoreSnapshot: vi.fn(),
  createHydrateAction:
    (type: string) =>
    (payload: unknown): { type: string; payload: unknown } => ({ type, payload })
}))

vi.mock('../StorageV2Service', () => ({
  getStorageV2CoreSnapshot: mocks.getStorageV2CoreSnapshot
}))

vi.mock('@renderer/store/assistants', () => ({
  hydrateAssistantsState: mocks.createHydrateAction('assistants/hydrate')
}))

vi.mock('@renderer/store/backup', () => ({
  hydrateBackupState: mocks.createHydrateAction('backup/hydrate')
}))

vi.mock('@renderer/store/codeTools', () => ({
  hydrateCodeToolsState: mocks.createHydrateAction('codeTools/hydrate')
}))

vi.mock('@renderer/store/copilot', () => ({
  hydrateCopilotState: mocks.createHydrateAction('copilot/hydrate')
}))

vi.mock('@renderer/store/inputTools', () => ({
  hydrateInputToolsState: mocks.createHydrateAction('inputTools/hydrate')
}))

vi.mock('@renderer/store/knowledge', () => ({
  hydrateKnowledgeState: mocks.createHydrateAction('knowledge/hydrate')
}))

vi.mock('@renderer/store/llm', () => ({
  hydrateLlmState: mocks.createHydrateAction('llm/hydrate')
}))

vi.mock('@renderer/store/mcp', () => ({
  hydrateMcpState: mocks.createHydrateAction('mcp/hydrate')
}))

vi.mock('@renderer/store/memory', () => ({
  hydrateMemoryState: mocks.createHydrateAction('memory/hydrate')
}))

vi.mock('@renderer/store/minapps', () => ({
  hydrateMinAppsState: mocks.createHydrateAction('minApps/hydrate')
}))

vi.mock('@renderer/store/note', () => ({
  hydrateNoteState: mocks.createHydrateAction('note/hydrate')
}))

vi.mock('@renderer/store/nutstore', () => ({
  hydrateNutstoreState: mocks.createHydrateAction('nutstore/hydrate')
}))

vi.mock('@renderer/store/ocr', () => ({
  hydrateOcrState: mocks.createHydrateAction('ocr/hydrate')
}))

vi.mock('@renderer/store/openclaw', () => ({
  hydrateOpenClawState: mocks.createHydrateAction('openclaw/hydrate')
}))

vi.mock('@renderer/store/paintings', () => ({
  hydratePaintingsState: mocks.createHydrateAction('paintings/hydrate')
}))

vi.mock('@renderer/store/preprocess', () => ({
  hydratePreprocessState: mocks.createHydrateAction('preprocess/hydrate')
}))

vi.mock('@renderer/store/selectionStore', () => ({
  hydrateSelectionState: mocks.createHydrateAction('selectionStore/hydrate')
}))

vi.mock('@renderer/store/settings', () => ({
  hydrateSettingsState: mocks.createHydrateAction('settings/hydrate')
}))

vi.mock('@renderer/store/shortcuts', () => ({
  hydrateShortcutsState: mocks.createHydrateAction('shortcuts/hydrate')
}))

vi.mock('@renderer/store/translate', () => ({
  hydrateTranslateState: mocks.createHydrateAction('translate/hydrate')
}))

vi.mock('@renderer/store/websearch', () => ({
  hydrateWebSearchState: mocks.createHydrateAction('websearch/hydrate')
}))

import { maybeHydrateRuntimeCacheFromStorageV2 } from '../StorageV2HydrationService'

describe('StorageV2HydrationService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    originalApi = window.api
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getSetting: vi.fn().mockResolvedValue({ enabled: true })
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('does not treat internal Storage v2 settings as recoverable runtime data', async () => {
    mocks.getStorageV2CoreSnapshot.mockResolvedValue({
      generatedAt: '2026-01-01T00:00:00.000Z',
      settings: {},
      llm: { providers: [] },
      assistants: { assistants: [] },
      redux: {},
      localStorage: {},
      metadata: {
        includeSecrets: true,
        settingCount: 1,
        providerCount: 0,
        assistantCount: 0,
        topicCount: 0,
        reduxSliceCount: 0,
        missingSecretCount: 0
      }
    })
    const target = { dispatch: vi.fn(), flush: vi.fn() }

    await expect(maybeHydrateRuntimeCacheFromStorageV2(target)).resolves.toEqual({
      hydrated: false,
      reason: 'empty'
    })
    expect(target.dispatch).not.toHaveBeenCalled()
    expect(target.flush).not.toHaveBeenCalled()
  })

  it('does not treat localStorage token clear markers alone as recoverable runtime data', async () => {
    mocks.getStorageV2CoreSnapshot.mockResolvedValue({
      generatedAt: '2026-01-01T00:00:00.000Z',
      settings: {},
      llm: { providers: [] },
      assistants: { assistants: [] },
      redux: {},
      localStorage: {
        clearedMcpProviderTokenKeys: ['mcprouter_token', 'modelscope_token'],
        durableValues: {},
        mcpProviderTokens: {}
      },
      metadata: {
        includeSecrets: true,
        settingCount: 2,
        providerCount: 0,
        assistantCount: 0,
        topicCount: 0,
        reduxSliceCount: 0,
        missingSecretCount: 0
      }
    })
    const target = { dispatch: vi.fn(), flush: vi.fn() }

    await expect(maybeHydrateRuntimeCacheFromStorageV2(target)).resolves.toEqual({
      hydrated: false,
      reason: 'empty'
    })
    expect(target.dispatch).not.toHaveBeenCalled()
    expect(target.flush).not.toHaveBeenCalled()
  })
})
