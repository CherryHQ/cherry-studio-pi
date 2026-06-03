import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataRootService: {
    ensureDataRoot: vi.fn()
  },
  database: {
    createSnapshot: vi.fn()
  },
  settingsRepository: {
    get: vi.fn()
  }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    default: actual
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return {
    ...actual,
    default: actual
  }
})

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: mocks.dataRootService
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: mocks.database
}))

vi.mock('../StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository
}))

import {
  listStorageV2LegacyRuntimePolicies,
  StorageV2LegacyRuntimeCleanupService
} from '../LegacyRuntimeCleanupService'

describe('StorageV2LegacyRuntimeCleanupService', () => {
  let tmpDir: string
  let configDir: string
  let userDataDir: string
  let dataRoot: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-v2-legacy-cleanup-'))
    configDir = path.join(tmpDir, 'config')
    userDataDir = path.join(tmpDir, 'userData')
    dataRoot = path.join(tmpDir, 'Data')
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.mkdirSync(dataRoot, { recursive: true })

    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'userData') return userDataDir
      return tmpDir
    })
    mocks.dataRootService.ensureDataRoot.mockReturnValue({ dataRoot })
    mocks.database.createSnapshot.mockResolvedValue({ path: path.join(dataRoot, 'snapshots', 'before-cleanup.db') })
    mocks.settingsRepository.get.mockResolvedValue(null)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createService() {
    return new StorageV2LegacyRuntimeCleanupService({ configDir, userDataDir })
  }

  it('defines explicit retention policy for legacy runtime stores and sensitive projections', () => {
    const policies = listStorageV2LegacyRuntimePolicies()
    const byId = new Map(policies.map((policy) => [policy.id, policy]))

    expect(byId.get('data-agents-db')).toMatchObject({
      role: 'runtime-cache',
      retention: 'keep'
    })
    expect(byId.get('openclaw-config')).toMatchObject({
      role: 'runtime-projection',
      retention: 'keep'
    })
    expect(byId.get('anthropic-oauth-legacy')).toMatchObject({
      role: 'sensitive-legacy-projection',
      retention: 'archive-after-storage-v2-backed'
    })
    expect(byId.get('legacy-user-data-agents-db')).toMatchObject({
      role: 'legacy-source',
      retention: 'manual-review'
    })
  })

  it('keeps existing sensitive legacy files in a dry run', async () => {
    const anthropicPath = path.join(configDir, 'oauth', 'anthropic.json')
    const copilotPath = path.join(userDataDir, '.copilot_token')
    fs.mkdirSync(path.dirname(anthropicPath), { recursive: true })
    fs.writeFileSync(anthropicPath, '{"access_token":"token"}')
    fs.writeFileSync(copilotPath, 'encrypted-token')
    mocks.settingsRepository.get.mockImplementation(async (key: string) => {
      if (key === 'anthropic.oauth.credentials') {
        return { credentialsSecretRef: 'storage-v2://secret/anthropic-oauth/default/credentials' }
      }
      return null
    })

    const report = await createService().cleanupSensitiveLegacyProjections()

    expect(report.dryRun).toBe(true)
    expect(report.snapshotPath).toBeNull()
    expect(report.items.find((item) => item.id === 'anthropic-oauth-legacy')).toMatchObject({
      action: 'archive',
      exists: true,
      storageV2State: 'backed'
    })
    expect(report.items.find((item) => item.id === 'copilot-token-user-data')).toMatchObject({
      action: 'keep',
      exists: true,
      storageV2State: 'missing'
    })
    expect(fs.existsSync(anthropicPath)).toBe(true)
    expect(fs.existsSync(copilotPath)).toBe(true)
    expect(mocks.database.createSnapshot).not.toHaveBeenCalled()
  })

  it('creates a Storage v2 snapshot before archiving backed sensitive legacy files', async () => {
    const anthropicPath = path.join(configDir, 'oauth', 'anthropic.json')
    const copilotPath = path.join(configDir, '.copilot_token')
    fs.mkdirSync(path.dirname(anthropicPath), { recursive: true })
    fs.writeFileSync(anthropicPath, '{"access_token":"token"}')
    fs.writeFileSync(copilotPath, 'encrypted-token')
    mocks.settingsRepository.get.mockImplementation(async (key: string) => {
      if (key === 'anthropic.oauth.credentials') {
        return { credentialsSecretRef: 'storage-v2://secret/anthropic-oauth/default/credentials' }
      }
      if (key === 'copilot.accessToken') {
        return { accessTokenSecretRef: 'storage-v2://secret/copilot/github/accessToken' }
      }
      return null
    })

    const report = await createService().cleanupSensitiveLegacyProjections({ dryRun: false })

    expect(mocks.database.createSnapshot).toHaveBeenCalledWith('before-sensitive-legacy-cleanup')
    expect(report.snapshotPath).toBe(path.join(dataRoot, 'snapshots', 'before-cleanup.db'))
    expect(report.archivedCount).toBe(2)
    expect(fs.existsSync(anthropicPath)).toBe(false)
    expect(fs.existsSync(copilotPath)).toBe(false)
    for (const item of report.items.filter((entry) => entry.archivedPath)) {
      expect(item.archivedPath).toContain(path.join(dataRoot, 'legacy', 'sensitive-projections-'))
      expect(fs.existsSync(item.archivedPath!)).toBe(true)
    }
  })

  it('archives stale legacy files when Storage v2 has an explicit clear marker', async () => {
    const anthropicPath = path.join(configDir, 'oauth', 'anthropic.json')
    fs.mkdirSync(path.dirname(anthropicPath), { recursive: true })
    fs.writeFileSync(anthropicPath, '{"access_token":"stale"}')
    mocks.settingsRepository.get.mockImplementation(async (key: string) => {
      if (key === 'anthropic.oauth.credentials') {
        return { clearedAt: '2026-05-29T00:00:00.000Z' }
      }
      return null
    })

    const report = await createService().cleanupSensitiveLegacyProjections({ dryRun: false })

    expect(report.items.find((item) => item.id === 'anthropic-oauth-legacy')).toMatchObject({
      action: 'archive',
      storageV2State: 'cleared'
    })
    expect(report.archivedCount).toBe(1)
    expect(fs.existsSync(anthropicPath)).toBe(false)
  })
})
