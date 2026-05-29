import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

vi.mock('../../storageV2/StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository
}))

import {
  CUSTOM_MIN_APPS_FILE_NAME,
  hydrateCustomMiniAppsFileFromStorageV2,
  loadCustomMiniAppsContentFromStorageV2,
  mirrorCustomMiniAppsContentToStorageV2,
  normalizeCustomMiniAppsContent,
  writeLegacyCustomMiniAppsFile
} from '../CustomMiniAppsStorageV2'

describe('CustomMiniAppsStorageV2', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'custom-minapps-storage-v2-'))
    mocks.settingsRepository.get.mockResolvedValue(null)
    mocks.settingsRepository.set.mockResolvedValue({ key: 'minapps.custom' })
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('normalizes custom mini apps JSON arrays', () => {
    expect(normalizeCustomMiniAppsContent('[{"id":"app-1","name":"App"}]')).toBe(
      JSON.stringify([{ id: 'app-1', name: 'App' }], null, 2)
    )
    expect(() => normalizeCustomMiniAppsContent('{"id":"not-array"}')).toThrow('JSON array')
  })

  it('loads custom mini apps from Storage v2 settings', async () => {
    mocks.settingsRepository.get.mockResolvedValue([{ id: 'app-1', name: 'App' }])

    await expect(loadCustomMiniAppsContentFromStorageV2()).resolves.toBe(
      JSON.stringify([{ id: 'app-1', name: 'App' }], null, 2)
    )
  })

  it('mirrors custom mini apps content to Storage v2 settings', async () => {
    await mirrorCustomMiniAppsContentToStorageV2('[{"id":"app-1","name":"App"}]')

    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'minapps.custom',
      [{ id: 'app-1', name: 'App' }],
      'minapps'
    )
  })

  it('hydrates the legacy custom mini apps file from Storage v2', async () => {
    mocks.settingsRepository.get.mockResolvedValue([{ id: 'app-1', name: 'App' }])
    const filePath = path.join(tempDir, CUSTOM_MIN_APPS_FILE_NAME)

    await expect(hydrateCustomMiniAppsFileFromStorageV2(filePath)).resolves.toBe(
      JSON.stringify([{ id: 'app-1', name: 'App' }], null, 2)
    )

    await expect(readFile(filePath, 'utf8')).resolves.toBe(JSON.stringify([{ id: 'app-1', name: 'App' }], null, 2))
  })

  it('writes normalized legacy custom mini apps content', async () => {
    const filePath = path.join(tempDir, 'nested', CUSTOM_MIN_APPS_FILE_NAME)

    await writeLegacyCustomMiniAppsFile(filePath, '[{"id":"app-1"}]')

    await expect(readFile(filePath, 'utf8')).resolves.toBe(JSON.stringify([{ id: 'app-1' }], null, 2))
  })
})
