import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  knowledgeNotesCount: vi.fn(),
  knowledgeNotesGet: vi.fn(),
  knowledgeNotesPut: vi.fn(),
  quickPhrasesCount: vi.fn(),
  quickPhrasesGet: vi.fn(),
  quickPhrasesPut: vi.fn(),
  translateHistoryCount: vi.fn(),
  translateHistoryGet: vi.fn(),
  translateHistoryPut: vi.fn(),
  translateLanguagesCount: vi.fn(),
  translateLanguagesGet: vi.fn(),
  translateLanguagesPut: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    knowledge_notes: {
      count: mocks.knowledgeNotesCount,
      get: mocks.knowledgeNotesGet,
      put: mocks.knowledgeNotesPut
    },
    quick_phrases: {
      count: mocks.quickPhrasesCount,
      get: mocks.quickPhrasesGet,
      put: mocks.quickPhrasesPut
    },
    translate_history: {
      count: mocks.translateHistoryCount,
      get: mocks.translateHistoryGet,
      put: mocks.translateHistoryPut
    },
    translate_languages: {
      count: mocks.translateLanguagesCount,
      get: mocks.translateLanguagesGet,
      put: mocks.translateLanguagesPut
    }
  }
}))

describe('StorageV2DexieTableRecoveryService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('projects a Storage v2 table scope into Dexie when the legacy table is empty', async () => {
    const listSettings = vi.fn().mockResolvedValue([
      {
        key: 'dexie.table.quick_phrases.phrase-1',
        value: {
          id: 'stale-id',
          title: 'Greeting',
          content: 'Hello',
          createdAt: 1760000000000,
          updatedAt: 1760000000000
        }
      },
      {
        key: 'dexie.table.quick_phrases.phrase-2',
        value: null
      }
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          listSettings
        }
      }
    })
    mocks.quickPhrasesCount.mockResolvedValue(0)

    const { storageV2DexieTableRecoveryService } = await import('../StorageV2DexieTableRecoveryService')

    await expect(
      storageV2DexieTableRecoveryService.projectTableIfEmpty('quick_phrases', 'quick-phrases-empty')
    ).resolves.toBe(true)

    expect(listSettings).toHaveBeenCalledWith('dexie-table:quick_phrases')
    expect(mocks.quickPhrasesPut).toHaveBeenCalledWith({
      id: 'phrase-1',
      title: 'Greeting',
      content: 'Hello',
      createdAt: 1760000000000,
      updatedAt: 1760000000000
    })
  })

  it('projects a single Storage v2 row when a referenced Dexie row is missing', async () => {
    const getSetting = vi.fn().mockResolvedValue({
      id: 'stale-id',
      type: 'note',
      content: 'Recovered note',
      created_at: 1760000000000,
      updated_at: 1760000000001
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getSetting
        }
      }
    })
    mocks.knowledgeNotesGet.mockResolvedValue(null)

    const { storageV2DexieTableRecoveryService } = await import('../StorageV2DexieTableRecoveryService')

    await expect(
      storageV2DexieTableRecoveryService.projectRowIfMissing('knowledge_notes', 'note-1', 'knowledge-note-missing')
    ).resolves.toBe(true)

    expect(getSetting).toHaveBeenCalledWith('dexie.table.knowledge_notes.note-1')
    expect(mocks.knowledgeNotesPut).toHaveBeenCalledWith({
      id: 'note-1',
      type: 'note',
      content: 'Recovered note',
      created_at: 1760000000000,
      updated_at: 1760000000001
    })
  })

  it('projects missing Storage v2 rows when the legacy table is partially populated', async () => {
    const listSettings = vi.fn().mockResolvedValue([
      {
        key: 'dexie.table.quick_phrases.phrase-existing',
        value: {
          title: 'Existing',
          content: 'Already in Dexie',
          createdAt: 1760000000000,
          updatedAt: 1760000000000
        }
      },
      {
        key: 'dexie.table.quick_phrases.phrase-missing',
        value: {
          title: 'Missing',
          content: 'Only in Storage v2',
          createdAt: 1760000000001,
          updatedAt: 1760000000001
        }
      },
      {
        key: 'dexie.table.quick_phrases.phrase-deleted',
        value: null
      }
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          listSettings
        }
      }
    })
    mocks.quickPhrasesGet.mockImplementation(async (id: string) =>
      id === 'phrase-existing' ? { id, title: 'Existing' } : null
    )

    const { storageV2DexieTableRecoveryService } = await import('../StorageV2DexieTableRecoveryService')

    await expect(
      storageV2DexieTableRecoveryService.projectMissingRows('quick_phrases', 'quick-phrases-list')
    ).resolves.toBe(true)

    expect(listSettings).toHaveBeenCalledWith('dexie-table:quick_phrases')
    expect(mocks.quickPhrasesPut).toHaveBeenCalledTimes(1)
    expect(mocks.quickPhrasesPut).toHaveBeenCalledWith({
      id: 'phrase-missing',
      title: 'Missing',
      content: 'Only in Storage v2',
      createdAt: 1760000000001,
      updatedAt: 1760000000001
    })
  })
})
