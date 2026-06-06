import fs from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataRootService: {
    ensureDataRoot: vi.fn()
  }
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: mocks.dataRootService
}))

import { StorageV2SecretVaultService } from '../SecretVaultService'

describe('StorageV2SecretVaultService', () => {
  let tmpDir: string
  let dataRoot: string
  let secretVaultService: StorageV2SecretVaultService

  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await fs.mkdtemp('/tmp/storage-v2-vault-')
    dataRoot = path.join(tmpDir, 'Data')
    secretVaultService = new StorageV2SecretVaultService()
    mocks.dataRootService.ensureDataRoot.mockReturnValue({
      dataRoot,
      manifest: null,
      source: 'env',
      candidates: []
    })
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses encoded vault ids so encoded refs can be read back', async () => {
    const secretRef = await secretVaultService.setSecret('provider', 'provider 1/alpha', 'api key', 'token')

    expect(secretRef).toBe('storage-v2://secret/provider/provider%201%2Falpha/api%20key')
    await expect(secretVaultService.getSecret(secretRef)).resolves.toBe('token')

    const vault = JSON.parse(await fs.readFile(path.join(dataRoot, 'secrets', 'vault.json'), 'utf-8'))
    expect(Object.keys(vault.secrets)).toEqual(['provider:provider%201%2Falpha:api%20key'])
    expect(vault.secrets['provider:provider%201%2Falpha:api%20key']).toMatchObject({
      encoding: 'cherry-local-aes-256-gcm'
    })
    await expect(fs.access(path.join(dataRoot, 'secrets', 'master.key'))).resolves.toBeUndefined()
  })

  it('treats undecryptable secret values as unavailable instead of throwing', async () => {
    const secretRef = await secretVaultService.setSecret('provider', 'provider-1', 'apiKey', 'token')
    const vaultPath = path.join(dataRoot, 'secrets', 'vault.json')
    const vault = JSON.parse(await fs.readFile(vaultPath, 'utf-8'))
    vault.secrets['provider:provider-1:apiKey'].authTag = Buffer.alloc(16, 1).toString('base64')
    await fs.writeFile(vaultPath, JSON.stringify(vault))

    await expect(secretVaultService.getSecret(secretRef)).resolves.toBeNull()
  })

  it('treats malformed secret references as unavailable instead of throwing', async () => {
    await expect(secretVaultService.getSecret('not-a-storage-v2-secret-ref')).resolves.toBeNull()
    await expect(secretVaultService.getSecret('storage-v2://secret/provider/%E0%A4%A/apiKey')).resolves.toBeNull()
  })

  it('treats legacy electron safeStorage records as unavailable instead of prompting the OS keychain', async () => {
    await fs.mkdir(path.join(dataRoot, 'secrets'), { recursive: true })
    await fs.writeFile(
      path.join(dataRoot, 'secrets', 'vault.json'),
      JSON.stringify({
        version: 1,
        secrets: {
          'provider:provider-1:apiKey': {
            encrypted: Buffer.from('legacy-token').toString('base64'),
            encoding: 'electron-safe-storage',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    )

    await expect(secretVaultService.getSecret('storage-v2://secret/provider/provider-1/apiKey')).resolves.toBeNull()
  })

  it('prunes vault secrets that are no longer referenced by Storage v2 records', async () => {
    await secretVaultService.setSecret('provider', 'keep', 'apiKey', 'keep-token')
    const dropRef = await secretVaultService.setSecret('provider', 'drop', 'apiKey', 'drop-token')

    const result = await secretVaultService.pruneUnreferencedSecretIds(['provider:keep:apiKey'])

    expect(result).toEqual({
      beforeCount: 2,
      afterCount: 1,
      prunedCount: 1,
      prunedSecretIds: ['provider:drop:apiKey']
    })
    await expect(secretVaultService.getSecret(dropRef)).resolves.toBeNull()

    const vault = JSON.parse(await fs.readFile(path.join(dataRoot, 'secrets', 'vault.json'), 'utf-8'))
    expect(Object.keys(vault.secrets)).toEqual(['provider:keep:apiKey'])
  })

  it('exports decryptable secrets and imports newer remote secrets without replacing newer local values', async () => {
    const keepRef = await secretVaultService.setSecret('provider', 'keep', 'apiKey', 'local-token')
    const localVaultPath = path.join(dataRoot, 'secrets', 'vault.json')
    const localVault = JSON.parse(await fs.readFile(localVaultPath, 'utf-8'))
    localVault.secrets['provider:keep:apiKey'].updatedAt = '2026-01-02T00:00:00.000Z'
    await fs.writeFile(localVaultPath, JSON.stringify(localVault))

    await secretVaultService.importPlaintextSecrets({
      'provider:keep:apiKey': {
        value: 'older-remote-token',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      'provider:new:apiKey': {
        value: 'new-remote-token',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    })

    await expect(secretVaultService.getSecret(keepRef)).resolves.toBe('local-token')
    await expect(secretVaultService.getSecret('storage-v2://secret/provider/new/apiKey')).resolves.toBe(
      'new-remote-token'
    )

    const exported = await secretVaultService.exportPlaintextSecrets()
    expect(exported['provider:keep:apiKey']).toMatchObject({
      value: 'local-token',
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    expect(exported['provider:new:apiKey']).toMatchObject({
      value: 'new-remote-token',
      updatedAt: '2026-01-03T00:00:00.000Z'
    })
  })
})
