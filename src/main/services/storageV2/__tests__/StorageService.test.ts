import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentDbMirrorService: {
    flush: vi.fn()
  },
  backupService: {
    createBackup: vi.fn(),
    restoreBackup: vi.fn(),
    validateBackup: vi.fn()
  },
  dataRootService: {
    resolveDataRoot: vi.fn()
  },
  legacyAgentDbImportService: {
    importSnapshot: vi.fn()
  },
  legacyAppDbImportService: {
    importSnapshot: vi.fn()
  },
  legacyDexieImportService: {
    importSnapshot: vi.fn()
  },
  legacyReduxImportService: {
    importSnapshot: vi.fn()
  },
  migrationAuditService: {
    runAudit: vi.fn()
  },
  migrationRunService: {
    listRuns: vi.fn(),
    recordRun: vi.fn()
  },
  secretVault: {
    getSecret: vi.fn(),
    setSecret: vi.fn()
  },
  statisticsService: {
    getStats: vi.fn()
  },
  database: {
    createSnapshot: vi.fn(),
    healthCheck: vi.fn(),
    integrityReport: vi.fn()
  },
  settingsRepository: {
    get: vi.fn(),
    list: vi.fn(),
    set: vi.fn()
  },
  providerRepository: {
    list: vi.fn(),
    listCredentialRefs: vi.fn(),
    upsert: vi.fn()
  },
  assistantRepository: {
    list: vi.fn(),
    upsert: vi.fn()
  },
  conversationRepository: {
    delete: vi.fn(),
    importConversation: vi.fn(),
    list: vi.fn(),
    listMessages: vi.fn(),
    upsertConversation: vi.fn(),
    upsertMessage: vi.fn(),
    upsertMessageBlocks: vi.fn()
  },
  fileRepository: {
    delete: vi.fn(),
    importFile: vi.fn()
  }
}))

vi.mock('../AgentDbMirrorService', () => ({
  storageV2AgentDbMirrorService: mocks.agentDbMirrorService
}))

vi.mock('../BackupService', () => ({
  storageV2BackupService: mocks.backupService
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: mocks.dataRootService
}))

vi.mock('../LegacyAgentDbImportService', () => ({
  storageV2LegacyAgentDbImportService: mocks.legacyAgentDbImportService
}))

vi.mock('../LegacyAppDbImportService', () => ({
  storageV2LegacyAppDbImportService: mocks.legacyAppDbImportService
}))

vi.mock('../LegacyDexieImportService', () => ({
  storageV2LegacyDexieImportService: mocks.legacyDexieImportService
}))

vi.mock('../LegacyReduxImportService', () => ({
  storageV2LegacyReduxImportService: mocks.legacyReduxImportService
}))

vi.mock('../MigrationAuditService', () => ({
  storageV2MigrationAuditService: mocks.migrationAuditService
}))

vi.mock('../MigrationRunService', () => ({
  storageV2MigrationRunService: mocks.migrationRunService
}))

vi.mock('../SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

vi.mock('../StatisticsService', () => ({
  storageV2StatisticsService: mocks.statisticsService
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: mocks.database
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2AssistantRepository: mocks.assistantRepository,
  storageV2ConversationRepository: mocks.conversationRepository,
  storageV2FileRepository: mocks.fileRepository,
  storageV2ProviderRepository: mocks.providerRepository,
  storageV2SettingsRepository: mocks.settingsRepository
}))

import { StorageV2Service } from '../StorageService'

describe('StorageV2Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsRepository.list.mockResolvedValue([])
    mocks.providerRepository.list.mockResolvedValue([])
    mocks.providerRepository.listCredentialRefs.mockResolvedValue(new Map())
    mocks.assistantRepository.list.mockResolvedValue([])
    mocks.conversationRepository.list.mockResolvedValue([])
  })

  it('restores localStorage MCP provider tokens from secret refs in core snapshots', async () => {
    const secretRef = 'storage-v2://secret/mcp-provider-token/mcprouter_token/token'
    mocks.settingsRepository.list.mockResolvedValue([
      {
        key: 'localStorage.durableValues',
        value: {
          language: 'zh-CN',
          'onboarding-completed': 'true'
        },
        scope: 'localStorage',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'localStorage.clearedMcpProviderTokenKeys',
        value: ['ai302_token', 'mcprouter_token', 'unexpected_token'],
        scope: 'localStorage',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'localStorage.mcpProviderTokens',
        value: {
          mcprouter_token: {
            tokenSecretRef: secretRef
          },
          modelscope_token: 'legacy-clear-token'
        },
        scope: 'localStorage',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      }
    ])
    mocks.secretVault.getSecret.mockResolvedValue('restored-token')

    const snapshot = await new StorageV2Service().getCoreSnapshot({ includeSecrets: true })

    expect(snapshot.localStorage.durableValues).toEqual({
      language: 'zh-CN',
      'onboarding-completed': 'true'
    })
    expect(snapshot.localStorage.mcpProviderTokens).toEqual({
      mcprouter_token: 'restored-token',
      modelscope_token: 'legacy-clear-token'
    })
    expect(snapshot.localStorage.clearedMcpProviderTokenKeys).toEqual(['ai302_token'])
    expect(snapshot.metadata.missingSecretCount).toBe(0)
    expect(mocks.secretVault.getSecret).toHaveBeenCalledWith(secretRef)
  })

  it('omits localStorage MCP provider tokens when exporting without secrets', async () => {
    mocks.settingsRepository.list.mockResolvedValue([
      {
        key: 'settings.s3',
        value: {
          bucket: 'user-bucket',
          secretAccessKey: 'legacy-s3-secret'
        },
        scope: 'settings',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'llm.settings',
        value: {
          awsBedrock: {
            apiKey: 'legacy-bedrock-key',
            region: 'us-east-1'
          }
        },
        scope: 'llm',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'redux.mcp',
        value: {
          servers: [
            {
              id: 'server-1',
              env: {
                API_TOKEN: 'legacy-env-token'
              },
              envSecretRefs: {
                API_TOKEN: 'storage-v2://secret/mcp-server/server-1/env.API_TOKEN'
              }
            }
          ]
        },
        scope: 'redux',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'redux.codeTools',
        value: {
          environmentVariables: {
            tool: 'legacy-tool-secret'
          },
          environmentVariableSecretRefs: {
            tool: 'storage-v2://secret/code-tools/tool/environmentVariable'
          }
        },
        scope: 'redux',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'redux.copilot',
        value: {
          defaultHeaders: {
            Authorization: 'Bearer legacy-token',
            'X-Client': 'desktop'
          }
        },
        scope: 'redux',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'localStorage.mcpProviderTokens',
        value: {
          mcprouter_token: {
            tokenSecretRef: 'storage-v2://secret/mcp-provider-token/mcprouter_token/token'
          },
          modelscope_token: 'legacy-clear-token'
        },
        scope: 'localStorage',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      },
      {
        key: 'localStorage.clearedMcpProviderTokenKeys',
        value: ['ai302_token', 'mcprouter_token', 'unexpected_token'],
        scope: 'localStorage',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null
      }
    ])

    const snapshot = await new StorageV2Service().getCoreSnapshot()

    expect(snapshot.settings.s3).toEqual({ bucket: 'user-bucket' })
    expect(snapshot.llm.settings).toEqual({ awsBedrock: { region: 'us-east-1' } })
    expect(snapshot.redux.mcp).toEqual({ servers: [{ id: 'server-1' }] })
    expect(snapshot.redux.codeTools).toEqual({})
    expect(snapshot.redux.copilot).toEqual({
      defaultHeaders: {
        'X-Client': 'desktop'
      }
    })
    expect(snapshot.localStorage.mcpProviderTokens).toEqual({})
    expect(snapshot.localStorage.clearedMcpProviderTokenKeys).toEqual(['ai302_token'])
    expect(snapshot.metadata.includeSecrets).toBe(false)
    expect(mocks.secretVault.getSecret).not.toHaveBeenCalled()
  })
})
