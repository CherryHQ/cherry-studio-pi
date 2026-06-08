import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fs: {
    chmodSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    renameSync: vi.fn(),
    writeFileSync: vi.fn()
  },
  homedir: vi.fn(),
  secretVault: {
    getSecret: vi.fn(),
    setSecret: vi.fn()
  },
  settingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('node:fs', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('node:os', () => ({
  default: {
    homedir: mocks.homedir
  },
  homedir: mocks.homedir
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/constant', () => ({
  isWin: false
}))

vi.mock('@main/core/platform', () => ({
  isWin: false
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({
      broadcastToType: vi.fn()
    }))
  }
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn(() => Promise.resolve(false))
}))

vi.mock('@main/utils/process', () => ({
  crossPlatformSpawn: vi.fn(),
  findExecutableInEnv: vi.fn(),
  getBinaryPath: vi.fn(() => Promise.resolve('/mock/bin/openclaw')),
  runInstallScript: vi.fn()
}))

vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn(() => Promise.resolve({ PATH: '/usr/bin' })),
  refreshShellEnv: vi.fn(() => Promise.resolve({ PATH: '/usr/bin' }))
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: { OpenClaw_InstallProgress: 'openclaw:install-progress' }
}))

vi.mock('@shared/utils', () => ({
  formatApiHost: vi.fn((url: string, appendVersion = true) => (appendVersion ? `${url}/v1` : url)),
  hasAPIVersion: vi.fn((url: string) => /\/v\d+(?:\/|$)/.test(url)),
  withoutTrailingSlash: vi.fn((url: string) => url.replace(/\/+$/, ''))
}))

vi.mock('../VertexAIService', () => ({
  default: { getInstance: vi.fn() }
}))

vi.mock('../storageV2/SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

vi.mock('../storageV2/StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository
}))

async function loadOpenClawService() {
  vi.resetModules()
  const { OpenClawService } = await import('../OpenClawService')
  return new OpenClawService()
}

const provider = {
  apiHost: 'https://api.openai.com',
  apiKey: 'sk-one,sk-two',
  id: 'openai',
  models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
  name: 'OpenAI',
  type: 'openai'
} as any

const primaryModel = { id: 'gpt-4o', name: 'GPT-4o' } as any

function getWrittenConfig() {
  const content = vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1]
  return JSON.parse(String(content))
}

describe('OpenClawService Storage v2 config snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.homedir.mockReturnValue('/mock/home')
    mocks.fs.existsSync.mockReturnValue(false)
    mocks.secretVault.getSecret.mockResolvedValue(null)
    mocks.secretVault.setSecret.mockResolvedValue('storage-v2://secret/openclaw/default/config')
    mocks.settingsRepository.get.mockResolvedValue(null)
    mocks.settingsRepository.set.mockResolvedValue({ key: 'openclaw.config' })
  })

  it('mirrors generated OpenClaw config to Storage v2 secret vault', async () => {
    const service = await loadOpenClawService()

    await expect(service.syncProviderConfig(provider, primaryModel)).resolves.toEqual({ success: true })

    const writtenConfig = getWrittenConfig()
    expect(writtenConfig.models.providers['cherry-openai'].apiKey).toBe('sk-one')
    expect(writtenConfig.gateway.auth.token).toEqual(expect.any(String))
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'openclaw',
      'default',
      'config',
      expect.stringContaining('sk-one')
    )
    expect(mocks.secretVault.setSecret.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0]
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/home/.openclaw/openclaw.json', expect.any(String), {
      encoding: 'utf-8',
      mode: 0o600
    })
    expect(fs.chmodSync).toHaveBeenCalledWith('/mock/home/.openclaw/openclaw.json', 0o600)
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'openclaw.config',
      {
        configSecretRef: 'storage-v2://secret/openclaw/default/config',
        updatedAt: expect.any(String)
      },
      'openclaw'
    )
  })

  it('restores missing OpenClaw runtime config from Storage v2 before syncing', async () => {
    const restoredConfig = {
      gateway: {
        auth: { token: 'restored-token' },
        mode: 'local',
        port: 18790
      },
      models: {
        mode: 'merge',
        providers: {
          existing: {
            api: 'openai-completions',
            apiKey: 'existing-key',
            baseUrl: 'https://existing.example/v1',
            models: []
          }
        }
      }
    }
    mocks.settingsRepository.get.mockResolvedValue({ configSecretRef: 'storage-v2://secret/openclaw/default/config' })
    mocks.secretVault.getSecret.mockResolvedValue(JSON.stringify(restoredConfig))
    const service = await loadOpenClawService()

    await expect(service.syncProviderConfig(provider, primaryModel)).resolves.toEqual({ success: true })

    const writtenConfig = getWrittenConfig()
    expect(writtenConfig.gateway.auth.token).toBe('restored-token')
    expect(writtenConfig.models.providers.existing.apiKey).toBe('existing-key')
    expect(writtenConfig.models.providers['cherry-openai'].apiKey).toBe('sk-one')
  })

  it('migrates the legacy OpenClaw runtime projection before mirroring to Storage v2', async () => {
    const legacyConfig = {
      models: {
        mode: 'merge',
        providers: {
          legacy: {
            api: 'openai-completions',
            apiKey: 'legacy-key',
            baseUrl: 'https://legacy.example/v1',
            models: []
          }
        }
      }
    }
    mocks.fs.existsSync.mockImplementation((targetPath) =>
      ['/mock/home/.openclaw/openclaw.json', '/mock/home/.openclaw/openclaw.cherry.json'].includes(String(targetPath))
    )
    mocks.fs.readFileSync.mockReturnValue(JSON.stringify(legacyConfig))
    const service = await loadOpenClawService()

    await expect(service.syncProviderConfig(provider, primaryModel)).resolves.toEqual({ success: true })

    expect(fs.renameSync).toHaveBeenCalledWith(
      '/mock/home/.openclaw/openclaw.json',
      '/mock/home/.openclaw/openclaw.json.bak'
    )
    expect(fs.renameSync).toHaveBeenCalledWith(
      '/mock/home/.openclaw/openclaw.cherry.json',
      '/mock/home/.openclaw/openclaw.json'
    )
    expect(getWrittenConfig().models.providers.legacy.apiKey).toBe('legacy-key')
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'openclaw',
      'default',
      'config',
      expect.stringContaining('legacy-key')
    )
  })

  it('does not update the OpenClaw runtime projection when Storage v2 snapshot fails', async () => {
    mocks.secretVault.setSecret.mockRejectedValueOnce(new Error('vault locked'))
    const service = await loadOpenClawService()

    await expect(service.syncProviderConfig(provider, primaryModel)).resolves.toEqual({
      success: false,
      message: 'vault locked'
    })

    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
