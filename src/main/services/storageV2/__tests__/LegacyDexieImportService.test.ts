import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  conversationRepository: {
    deleteMissingAssistantConversations: vi.fn(),
    importConversation: vi.fn()
  },
  fileRepository: {
    deleteMissingLegacyFiles: vi.fn(),
    importFile: vi.fn()
  },
  settingsRepository: {
    list: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2ConversationRepository: mocks.conversationRepository,
  storageV2FileRepository: mocks.fileRepository,
  storageV2SettingsRepository: mocks.settingsRepository
}))

import { StorageV2LegacyDexieImportService } from '../LegacyDexieImportService'

describe('StorageV2LegacyDexieImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.conversationRepository.importConversation.mockResolvedValue({ messageCount: 0, blockCount: 0 })
    mocks.conversationRepository.deleteMissingAssistantConversations.mockResolvedValue(0)
    mocks.fileRepository.importFile.mockResolvedValue({ imported: true })
    mocks.fileRepository.deleteMissingLegacyFiles.mockResolvedValue(0)
    mocks.settingsRepository.list.mockResolvedValue([])
  })

  it('imports legacy Dexie settings into the Storage v2 settings scope', async () => {
    const report = await new StorageV2LegacyDexieImportService().importSnapshot(
      {
        settings: [
          { id: 'pinned:models', value: ['openai:gpt-4o'] },
          { id: 'image://avatar', value: 'base64-avatar' },
          { id: '', value: 'ignored' }
        ]
      },
      { dryRun: false }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'dexie.settings.pinned:models',
      ['openai:gpt-4o'],
      'dexie-settings'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'dexie.settings.image://avatar',
      'base64-avatar',
      'dexie-settings'
    )
    expect(report.settingCount).toBe(2)
    expect(report.importedSettingCount).toBe(2)
  })

  it('imports legacy Dexie auxiliary table rows into Storage v2 setting records', async () => {
    const report = await new StorageV2LegacyDexieImportService().importSnapshot(
      {
        dexieTables: {
          quick_phrases: [
            {
              id: 'phrase-1',
              title: 'Greeting',
              content: 'Hello',
              createdAt: 1760000000000,
              updatedAt: 1760000000000
            }
          ],
          translate_languages: [{ id: '', value: 'ignored' }]
        }
      },
      { dryRun: false }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'dexie.table.quick_phrases.phrase-1',
      {
        id: 'phrase-1',
        title: 'Greeting',
        content: 'Hello',
        createdAt: 1760000000000,
        updatedAt: 1760000000000
      },
      'dexie-table:quick_phrases'
    )
    expect(report.dexieTableRowCount).toBe(1)
    expect(report.importedDexieTableRowCount).toBe(1)
    expect(report.warnings).toEqual(['Skipped legacy Dexie translate_languages row at index 0: missing row id.'])
  })

  it('writes delete markers for Dexie settings and auxiliary rows missing from a prune import', async () => {
    mocks.settingsRepository.list.mockImplementation(async (scope?: string) => {
      if (scope === 'dexie-settings') {
        return [
          {
            key: 'dexie.settings.image://avatar',
            value: 'active-avatar'
          },
          {
            key: 'dexie.settings.image://stale',
            value: 'stale-avatar'
          },
          {
            key: 'dexie.settings.image://already-deleted',
            value: null
          }
        ]
      }

      if (scope === 'dexie-table:quick_phrases') {
        return [
          {
            key: 'dexie.table.quick_phrases.phrase-1',
            value: { id: 'phrase-1' }
          },
          {
            key: 'dexie.table.quick_phrases.stale-phrase',
            value: { id: 'stale-phrase' }
          },
          {
            key: 'dexie.table.quick_phrases.already-deleted',
            value: null
          }
        ]
      }

      return []
    })

    const report = await new StorageV2LegacyDexieImportService().importSnapshot(
      {
        settings: [{ id: 'image://avatar', value: 'active-avatar' }],
        dexieTables: {
          quick_phrases: [{ id: 'phrase-1', title: 'Greeting' }]
        }
      },
      { dryRun: false, pruneMissing: true }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith('dexie.settings.image://stale', null, 'dexie-settings')
    expect(mocks.settingsRepository.set).not.toHaveBeenCalledWith(
      'dexie.settings.image://already-deleted',
      null,
      'dexie-settings'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'dexie.table.quick_phrases.stale-phrase',
      null,
      'dexie-table:quick_phrases'
    )
    expect(mocks.settingsRepository.set).not.toHaveBeenCalledWith(
      'dexie.table.quick_phrases.already-deleted',
      null,
      'dexie-table:quick_phrases'
    )
    expect(report.deletedSettingCount).toBe(1)
    expect(report.deletedDexieTableRowCount).toBe(1)
  })
})
