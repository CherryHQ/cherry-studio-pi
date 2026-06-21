import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentMirrorFlush: vi.fn(),
  agentMirrorGetStatus: vi.fn(),
  agentMirrorSuspend: vi.fn(),
  conversationMirrorFlush: vi.fn(),
  conversationMirrorGetStatus: vi.fn(),
  conversationMirrorSuspend: vi.fn(),
  createBackup: vi.fn(),
  createSnapshot: vi.fn(),
  dexieSettingsMirrorFlush: vi.fn(),
  dexieSettingsMirrorGetStatus: vi.fn(),
  dexieSettingsMirrorInstall: vi.fn(),
  dexieSettingsMirrorSuspend: vi.fn(),
  dexieTableMirrorFlush: vi.fn(),
  dexieTableMirrorGetStatus: vi.fn(),
  dexieTableMirrorInstall: vi.fn(),
  dexieTableMirrorSuspend: vi.fn(),
  fileMirrorFlush: vi.fn(),
  fileMirrorGetStatus: vi.fn(),
  fileMirrorSuspend: vi.fn(),
  filesToArray: vi.fn(),
  getState: vi.fn(),
  importLegacyAgentDb: vi.fn(),
  importLegacyAppDb: vi.fn(),
  importLegacyDexieSnapshot: vi.fn(),
  importLegacyReduxSnapshot: vi.fn(),
  recordMigrationRun: vi.fn(),
  knowledgeNotesToArray: vi.fn(),
  localStorageGetSnapshot: vi.fn(),
  localStorageGetStatus: vi.fn(),
  localStorageMirrorFlush: vi.fn(),
  localStorageSuspend: vi.fn(),
  messageBlocksAnyOf: vi.fn(),
  messageBlocksToArray: vi.fn(),
  messageBlocksWhere: vi.fn(),
  quickPhrasesToArray: vi.fn(),
  reduxMirrorFlush: vi.fn(),
  reduxMirrorGetStatus: vi.fn(),
  reduxMirrorSuspend: vi.fn(),
  restoreBackup: vi.fn(),
  settingsToArray: vi.fn(),
  topicsGet: vi.fn(),
  topicsToArray: vi.fn(),
  translateHistoryToArray: vi.fn(),
  translateLanguagesToArray: vi.fn()
}))

vi.mock('../StorageV2AgentMirrorService', () => ({
  storageV2AgentMirrorService: {
    flushStrict: mocks.agentMirrorFlush,
    getStatus: mocks.agentMirrorGetStatus,
    suspendUntilReload: mocks.agentMirrorSuspend
  }
}))

vi.mock('../StorageV2ConversationMirrorService', () => ({
  storageV2ConversationMirrorService: {
    flushStrict: mocks.conversationMirrorFlush,
    getStatus: mocks.conversationMirrorGetStatus,
    suspendUntilReload: mocks.conversationMirrorSuspend
  }
}))

vi.mock('../StorageV2DexieSettingsMirrorService', () => ({
  storageV2DexieSettingsMirrorService: {
    flushStrict: mocks.dexieSettingsMirrorFlush,
    getStatus: mocks.dexieSettingsMirrorGetStatus,
    install: mocks.dexieSettingsMirrorInstall,
    suspendUntilReload: mocks.dexieSettingsMirrorSuspend
  }
}))

vi.mock('../StorageV2DexieTableMirrorService', () => ({
  STORAGE_V2_DEXIE_TABLE_NAMES: ['settings'] as const,
  storageV2DexieTableMirrorService: {
    flushStrict: mocks.dexieTableMirrorFlush,
    getStatus: mocks.dexieTableMirrorGetStatus,
    install: mocks.dexieTableMirrorInstall,
    suspendUntilReload: mocks.dexieTableMirrorSuspend
  }
}))

vi.mock('../StorageV2FileMirrorService', () => ({
  storageV2FileMirrorService: {
    flushStrict: mocks.fileMirrorFlush,
    getStatus: mocks.fileMirrorGetStatus,
    suspendUntilReload: mocks.fileMirrorSuspend
  }
}))

vi.mock('../StorageV2LocalStorageSnapshot', () => ({
  flushStorageV2LocalStorageMirrorStrict: mocks.localStorageMirrorFlush,
  getStorageV2LocalStorageMirrorStatus: mocks.localStorageGetStatus,
  getStorageV2LocalStorageSnapshot: mocks.localStorageGetSnapshot,
  suspendStorageV2LocalStorageMirrorUntilReload: mocks.localStorageSuspend
}))

vi.mock('../StorageV2MirrorService', () => ({
  storageV2MirrorService: {
    flushStrict: mocks.reduxMirrorFlush,
    getStatus: mocks.reduxMirrorGetStatus,
    suspendUntilReload: mocks.reduxMirrorSuspend
  }
}))

vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      toArray: mocks.filesToArray
    },
    knowledge_notes: {
      toArray: mocks.knowledgeNotesToArray
    },
    message_blocks: {
      where: mocks.messageBlocksWhere
    },
    quick_phrases: {
      toArray: mocks.quickPhrasesToArray
    },
    settings: {
      toArray: mocks.settingsToArray
    },
    topics: {
      get: mocks.topicsGet,
      toArray: mocks.topicsToArray
    },
    translate_history: {
      toArray: mocks.translateHistoryToArray
    },
    translate_languages: {
      toArray: mocks.translateLanguagesToArray
    }
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: mocks.getState
  }
}))

describe('StorageV2Service legacy Dexie snapshots', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: {
        storageV2: {
          createBackup: mocks.createBackup,
          createSnapshot: mocks.createSnapshot,
          importLegacyAgentDb: mocks.importLegacyAgentDb,
          importLegacyAppDb: mocks.importLegacyAppDb,
          importLegacyDexieSnapshot: mocks.importLegacyDexieSnapshot,
          importLegacyReduxSnapshot: mocks.importLegacyReduxSnapshot,
          recordMigrationRun: mocks.recordMigrationRun,
          restoreBackup: mocks.restoreBackup
        }
      }
    })
    mocks.agentMirrorFlush.mockResolvedValue(undefined)
    mocks.agentMirrorGetStatus.mockReturnValue({ id: 'agent', pendingCount: 0, inflight: false, suspended: false })
    mocks.conversationMirrorFlush.mockResolvedValue(undefined)
    mocks.conversationMirrorGetStatus.mockReturnValue({
      id: 'conversation',
      pendingCount: 0,
      inflight: false,
      suspended: false
    })
    mocks.createBackup.mockResolvedValue({ path: '/tmp/backup' })
    mocks.createSnapshot.mockResolvedValue({ path: '/tmp/snapshot' })
    mocks.dexieSettingsMirrorFlush.mockResolvedValue(undefined)
    mocks.dexieSettingsMirrorGetStatus.mockReturnValue({
      id: 'dexie-settings',
      pendingCount: 0,
      inflight: false,
      suspended: false
    })
    mocks.dexieTableMirrorFlush.mockResolvedValue(undefined)
    mocks.dexieTableMirrorGetStatus.mockReturnValue({
      id: 'dexie-table',
      pendingCount: 0,
      inflight: false,
      suspended: false
    })
    mocks.fileMirrorFlush.mockResolvedValue(undefined)
    mocks.fileMirrorGetStatus.mockReturnValue({ id: 'file', pendingCount: 0, inflight: false, suspended: false })
    mocks.filesToArray.mockResolvedValue([])
    mocks.importLegacyAgentDb.mockResolvedValue({})
    mocks.importLegacyAppDb.mockResolvedValue({})
    mocks.importLegacyDexieSnapshot.mockResolvedValue({})
    mocks.importLegacyReduxSnapshot.mockResolvedValue({})
    mocks.recordMigrationRun.mockResolvedValue(undefined)
    mocks.knowledgeNotesToArray.mockResolvedValue([])
    mocks.localStorageGetSnapshot.mockReturnValue({})
    mocks.localStorageGetStatus.mockReturnValue({
      id: 'local-storage',
      pendingCount: 0,
      inflight: false,
      suspended: false
    })
    mocks.localStorageMirrorFlush.mockResolvedValue(undefined)
    mocks.messageBlocksToArray.mockResolvedValue([{ id: 'block-1', messageId: 'message-1', type: 'main_text' }])
    mocks.messageBlocksAnyOf.mockReturnValue({ toArray: mocks.messageBlocksToArray })
    mocks.messageBlocksWhere.mockReturnValue({ anyOf: mocks.messageBlocksAnyOf })
    mocks.quickPhrasesToArray.mockResolvedValue([])
    mocks.reduxMirrorFlush.mockResolvedValue(undefined)
    mocks.reduxMirrorGetStatus.mockReturnValue({ id: 'redux', pendingCount: 0, inflight: false, suspended: false })
    mocks.restoreBackup.mockResolvedValue({ requiresRestart: true })
    mocks.settingsToArray.mockResolvedValue([])
    mocks.topicsToArray.mockResolvedValue([])
    mocks.translateHistoryToArray.mockResolvedValue([])
    mocks.translateLanguagesToArray.mockResolvedValue([])
    mocks.getState.mockReturnValue({
      backup: {},
      codeTools: {},
      copilot: {},
      inputTools: {},
      knowledge: {},
      llm: {},
      mcp: {},
      memory: {},
      minapps: {},
      note: {},
      nutstore: {},
      ocr: {},
      openclaw: {},
      paintings: {},
      preprocess: {},
      selectionStore: {},
      settings: {},
      shortcuts: {},
      translate: {},
      websearch: {},
      assistants: {
        defaultAssistant: {
          id: 'default-assistant',
          topics: []
        },
        assistants: [
          {
            id: 'redux-assistant',
            topics: [
              {
                id: 'redux-only-topic',
                assistantId: 'redux-assistant',
                name: 'Redux only',
                messages: []
              },
              {
                id: 'restored-topic',
                assistantId: 'redux-assistant',
                name: 'Stale Redux name',
                messages: []
              }
            ]
          }
        ],
        presets: []
      }
    })
  })

  it('can build restore snapshots from Dexie topics without stale Redux-only topics', async () => {
    mocks.topicsGet.mockImplementation(async (topicId: string) => {
      if (topicId === 'restored-topic') {
        return {
          id: 'restored-topic',
          name: 'Restored topic',
          messages: [
            {
              id: 'message-1',
              assistantId: 'message-assistant',
              blocks: ['block-1']
            }
          ]
        }
      }

      return undefined
    })

    const { getLegacyDexieSnapshotForStorageV2 } = await import('../StorageV2Service')
    const snapshot = await getLegacyDexieSnapshotForStorageV2({
      includeReduxOnlyTopics: false,
      preferMessageAssistantId: true
    })

    expect(snapshot.conversations).toHaveLength(1)
    expect(snapshot.conversations[0]).toEqual(
      expect.objectContaining({
        assistantId: 'message-assistant',
        messages: [
          {
            id: 'message-1',
            assistantId: 'message-assistant',
            blocks: ['block-1']
          }
        ],
        blocks: [{ id: 'block-1', messageId: 'message-1', type: 'main_text' }]
      })
    )
    expect(snapshot.conversations[0].topic).toEqual(
      expect.objectContaining({
        id: 'restored-topic',
        assistantId: 'message-assistant',
        name: 'Restored topic',
        messages: []
      })
    )
  })

  it('prepares the full runtime snapshot before local backup, snapshot, and restore operations', async () => {
    const { createStorageV2Backup, createStorageV2Snapshot, restoreStorageV2Backup } = await import(
      '../StorageV2Service'
    )

    await createStorageV2Backup('manual')
    await createStorageV2Snapshot('diagnostic')
    await restoreStorageV2Backup('/tmp/backup')

    expect(mocks.importLegacyReduxSnapshot).toHaveBeenCalledTimes(3)
    expect(mocks.importLegacyDexieSnapshot).toHaveBeenCalledTimes(3)
    expect(mocks.importLegacyAgentDb).toHaveBeenCalledTimes(3)
    expect(mocks.importLegacyAppDb).toHaveBeenCalledTimes(3)
    expect(mocks.createBackup).toHaveBeenCalledWith('manual')
    expect(mocks.createSnapshot).toHaveBeenCalledWith('diagnostic')
    expect(mocks.restoreBackup).toHaveBeenCalledWith('/tmp/backup')
    expect(mocks.importLegacyAppDb.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createBackup.mock.invocationCallOrder[0]
    )
    expect(mocks.importLegacyAppDb.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.createSnapshot.mock.invocationCallOrder[0]
    )
    expect(mocks.importLegacyAppDb.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.restoreBackup.mock.invocationCallOrder[0]
    )
    expect(mocks.reduxMirrorSuspend).toHaveBeenCalledTimes(1)
    expect(mocks.agentMirrorSuspend).toHaveBeenCalledTimes(1)
  })

  it('installs Dexie runtime mirrors for incremental local changes', async () => {
    const { installStorageV2RuntimeMirrors } = await import('../StorageV2Service')

    installStorageV2RuntimeMirrors()

    expect(mocks.dexieSettingsMirrorInstall).toHaveBeenCalledTimes(1)
    expect(mocks.dexieTableMirrorInstall).toHaveBeenCalledTimes(1)
  })

  it('records nested migration failure details', async () => {
    mocks.importLegacyReduxSnapshot.mockRejectedValueOnce({ error: { message: 'redux import bridge failed' } })

    const { runLegacyMigrationToStorageV2 } = await import('../StorageV2Service')

    await expect(runLegacyMigrationToStorageV2()).rejects.toThrow('redux import bridge failed')

    expect(mocks.recordMigrationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'full-legacy-import',
        status: 'failed',
        error: 'redux import bridge failed'
      })
    )
  })
})
