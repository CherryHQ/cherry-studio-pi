import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secretVault: {
    isAvailable: vi.fn(),
    setSecret: vi.fn()
  },
  settingsRepository: {
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
})
