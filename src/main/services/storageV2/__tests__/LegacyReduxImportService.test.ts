import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secretVault: {
    isAvailable: vi.fn(),
    setSecret: vi.fn()
  },
  settingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  },
  providerRepository: {
    upsert: vi.fn(),
    deleteMissing: vi.fn()
  },
  assistantRepository: {
    upsert: vi.fn(),
    deleteMissing: vi.fn()
  },
  knowledgeRepository: {
    importBases: vi.fn()
  }
}))

vi.mock('../SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository,
  storageV2ProviderRepository: mocks.providerRepository,
  storageV2AssistantRepository: mocks.assistantRepository,
  storageV2KnowledgeRepository: mocks.knowledgeRepository
}))

import { StorageV2LegacyReduxImportService } from '../LegacyReduxImportService'

describe('StorageV2LegacyReduxImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.secretVault.isAvailable.mockReturnValue(true)
    mocks.secretVault.setSecret.mockResolvedValue('storage-v2://secret/mcp-provider-token/mcprouter_token/token')
    mocks.settingsRepository.get.mockResolvedValue(null)
    mocks.providerRepository.deleteMissing.mockResolvedValue(0)
    mocks.assistantRepository.deleteMissing.mockResolvedValue(0)
    mocks.knowledgeRepository.importBases.mockResolvedValue({
      baseCount: 0,
      itemCount: 0,
      deletedBaseCount: 0,
      deletedItemCount: 0
    })
  })

  it('stores MCP provider localStorage tokens as secret refs', async () => {
    const report = await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        localStorage: {
          clearedMcpProviderTokenKeys: ['modelscope_token', 'unexpected_token', 'modelscope_token'],
          durableValues: {
            language: 'zh-CN',
            ignoredEmpty: '',
            ignoredNonString: true
          },
          mcpProviderTokens: {
            mcprouter_token: 'secret-token',
            unexpected_token: 'ignored-secret'
          }
        }
      },
      { dryRun: false }
    )

    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'mcp-provider-token',
      'mcprouter_token',
      'token',
      'secret-token'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'localStorage.mcpProviderTokens',
      {
        mcprouter_token: {
          tokenSecretRef: 'storage-v2://secret/mcp-provider-token/mcprouter_token/token'
        }
      },
      'localStorage'
    )
    expect(mocks.secretVault.setSecret).toHaveBeenCalledTimes(1)
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'localStorage.durableValues',
      {
        language: 'zh-CN'
      },
      'localStorage'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'localStorage.clearedMcpProviderTokenKeys',
      ['modelscope_token'],
      'localStorage'
    )
    expect(report.secretCandidateCount).toBe(1)
    expect(report.importedSecretCount).toBe(1)
  })

  it('stores flat sensitive settings as secret refs', async () => {
    mocks.secretVault.setSecret.mockImplementation(
      async (scope: string, ownerId: string, kind: string) => `storage-v2://secret/${scope}/${ownerId}/${kind}`
    )

    const report = await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        settings: {
          dataSyncWebdavPass: 'sync-pass',
          webdavPass: 'backup-pass',
          notionApiKey: 'notion-secret',
          yuqueToken: '',
          language: 'zh-CN'
        }
      },
      { dryRun: false }
    )

    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'settings',
      'dataSyncWebdavPass',
      'dataSyncWebdavPassword',
      'sync-pass'
    )
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'settings',
      'webdavPass',
      'backupWebdavPassword',
      'backup-pass'
    )
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'settings',
      'notionApiKey',
      'notionApiKey',
      'notion-secret'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'settings.dataSyncWebdavPass',
      {
        secretRef: 'storage-v2://secret/settings/dataSyncWebdavPass/dataSyncWebdavPassword'
      },
      'settings'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'settings.webdavPass',
      {
        secretRef: 'storage-v2://secret/settings/webdavPass/backupWebdavPassword'
      },
      'settings'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'settings.notionApiKey',
      {
        secretRef: 'storage-v2://secret/settings/notionApiKey/notionApiKey'
      },
      'settings'
    )
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith('settings.yuqueToken', '', 'settings')
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith('settings.language', 'zh-CN', 'settings')
    expect(report.secretCandidateCount).toBe(3)
    expect(report.importedSecretCount).toBe(3)
  })

  it('skips startup default WebDAV settings when Storage v2 already has meaningful values', async () => {
    mocks.settingsRepository.get.mockImplementation(async (key: string) => {
      if (key === 'settings.dataSyncWebdavHost') return 'https://dav.example.com'
      if (key === 'settings.dataSyncWebdavUser') return 'webdav-user'
      if (key === 'settings.dataSyncWebdavPass') {
        return { secretRef: 'storage-v2://secret/settings/dataSyncWebdavPass/dataSyncWebdavPassword' }
      }
      if (key === 'settings.dataSyncWebdavPath') return '/sync'
      if (key === 'settings.dataSyncAutoSync') return true
      if (key === 'settings.dataSyncSyncInterval') return 5
      return null
    })

    const report = await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        settings: {
          dataSyncWebdavHost: '',
          dataSyncWebdavUser: '',
          dataSyncWebdavPass: '',
          dataSyncWebdavPath: '/cherry-studio-pi',
          dataSyncAutoSync: false,
          dataSyncSyncInterval: 0,
          language: 'zh-CN'
        }
      },
      { dryRun: false, protectExistingFromDefaults: true }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith('settings.language', 'zh-CN', 'settings')
    expect(mocks.settingsRepository.set).not.toHaveBeenCalledWith(
      'settings.dataSyncWebdavHost',
      expect.anything(),
      'settings'
    )
    expect(mocks.settingsRepository.set).not.toHaveBeenCalledWith(
      'settings.dataSyncWebdavPass',
      expect.anything(),
      'settings'
    )
    expect(report.warnings).toContain('Skipped startup default overwrite for settings.dataSyncWebdavHost.')
    expect(report.warnings).toContain('Skipped startup default overwrite for settings.dataSyncWebdavPass.')
  })

  it('allows explicit WebDAV settings clears when startup default protection is disabled', async () => {
    mocks.settingsRepository.get.mockResolvedValue('https://dav.example.com')

    await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        settings: {
          dataSyncWebdavHost: ''
        }
      },
      { dryRun: false, protectExistingFromDefaults: false }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith('settings.dataSyncWebdavHost', '', 'settings')
  })

  it('does not prune providers or assistants when importing a localStorage-only snapshot', async () => {
    await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        localStorage: {
          durableValues: {
            'onboarding-completed': 'true'
          }
        }
      },
      { dryRun: false }
    )

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'localStorage.durableValues',
      {
        'onboarding-completed': 'true'
      },
      'localStorage'
    )
    expect(mocks.providerRepository.deleteMissing).not.toHaveBeenCalled()
    expect(mocks.assistantRepository.deleteMissing).not.toHaveBeenCalled()
  })

  it('honors pruneMissing false for full runtime snapshots', async () => {
    await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        llm: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              type: 'openai',
              models: []
            } as any
          ]
        },
        assistants: {
          assistants: [
            {
              id: 'assistant-1',
              name: 'Assistant',
              prompt: '',
              topics: []
            } as any
          ]
        },
        redux: {
          knowledge: {
            bases: [
              {
                id: 'kb-1',
                name: 'Knowledge',
                items: []
              }
            ]
          }
        }
      },
      { dryRun: false, pruneMissing: false }
    )

    expect(mocks.providerRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai' }),
      0,
      undefined
    )
    expect(mocks.assistantRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'assistant-1' }), 0)
    expect(mocks.knowledgeRepository.importBases).toHaveBeenCalledWith([expect.objectContaining({ id: 'kb-1' })], {
      pruneMissing: false
    })
    expect(mocks.providerRepository.deleteMissing).not.toHaveBeenCalled()
    expect(mocks.assistantRepository.deleteMissing).not.toHaveBeenCalled()
  })

  it('deduplicates repeated providers and models in runtime snapshots', async () => {
    const report = await new StorageV2LegacyReduxImportService().importSnapshot(
      {
        llm: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI A',
              type: 'openai',
              models: [
                { id: 'gpt-4o', name: 'Old GPT-4o' },
                { id: 'gpt-4o-mini', name: 'GPT-4o mini' }
              ]
            } as any,
            {
              id: 'openai',
              name: 'OpenAI B',
              type: 'openai',
              models: [
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: '', name: 'Invalid' }
              ]
            } as any
          ]
        }
      },
      { dryRun: false }
    )

    expect(report.providerCount).toBe(1)
    expect(report.modelCount).toBe(2)
    expect(mocks.providerRepository.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.providerRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'openai',
        name: 'OpenAI B',
        models: [
          expect.objectContaining({ id: 'gpt-4o', name: 'GPT-4o' }),
          expect.objectContaining({ id: 'gpt-4o-mini', name: 'GPT-4o mini' })
        ]
      }),
      0,
      undefined
    )
    expect(mocks.providerRepository.deleteMissing).toHaveBeenCalledWith(['openai'])
  })
})
