import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { storageV2DataRootService } from './DataRootService'

type SecretVaultFile = {
  version: 1
  secrets: Record<
    string,
    {
      encrypted: string
      encoding: 'cherry-local-aes-256-gcm' | 'electron-safe-storage'
      iv?: string
      authTag?: string
      updatedAt: string
    }
  >
}

export type StorageV2PlaintextSecretVaultEntry = {
  value: string
  updatedAt: string
}

export type StorageV2SecretVaultImportResult = {
  importedCount: number
  skippedCount: number
}

export type StorageV2SecretVaultPruneResult = {
  beforeCount: number
  afterCount: number
  prunedCount: number
  prunedSecretIds: string[]
}

const VAULT_VERSION = 1
const SECRET_REF_PREFIX = 'storage-v2://secret/'
const LOCAL_VAULT_ENCODING = 'cherry-local-aes-256-gcm'
const MASTER_KEY_BYTE_LENGTH = 32
const GCM_IV_BYTE_LENGTH = 12

function encodeSecretId(scope: string, ownerId: string, kind: string) {
  return [scope, ownerId, kind].map((part) => encodeURIComponent(part)).join('/')
}

function decodeSecretRef(secretRef: string) {
  if (!secretRef.startsWith(SECRET_REF_PREFIX)) {
    throw new Error('Invalid Storage v2 secret reference')
  }

  const parts = secretRef.slice(SECRET_REF_PREFIX.length).split('/')
  for (const part of parts) {
    decodeURIComponent(part)
  }
  return parts.join(':')
}

function parseUpdatedAt(value: unknown) {
  if (typeof value !== 'string' || !value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class StorageV2SecretVaultService {
  private writeQueue: Promise<unknown> = Promise.resolve()
  private masterKey: Buffer | null = null
  private masterKeyPath: string | null = null

  isAvailable() {
    return true
  }

  async setSecret(scope: string, ownerId: string, kind: string, value: string): Promise<string> {
    const secretId = encodeSecretId(scope, ownerId, kind)
    const secretRef = `${SECRET_REF_PREFIX}${secretId}`
    await this.enqueueVaultWrite(async () => {
      const vault = await this.readVault()
      const encrypted = await this.encryptLocal(value)

      vault.secrets[secretId.replace(/\//g, ':')] = {
        ...encrypted,
        encoding: LOCAL_VAULT_ENCODING,
        updatedAt: new Date().toISOString()
      }

      await this.writeVault(vault)
    })
    return secretRef
  }

  async getSecret(secretRef: string): Promise<string | null> {
    await this.waitForIdle()

    const secretId = safeDecodeSecretRef(secretRef)
    if (!secretId) return null

    const vault = await this.readVault().catch(() => null)
    if (!vault) return null

    const record = vault.secrets[secretId]
    if (!record) return null

    try {
      if (record.encoding !== LOCAL_VAULT_ENCODING) {
        return null
      }

      return await this.decryptLocal(record)
    } catch {
      return null
    }
  }

  async waitForIdle(): Promise<void> {
    await this.writeQueue
  }

  async exportPlaintextSecrets(): Promise<Record<string, StorageV2PlaintextSecretVaultEntry>> {
    await this.waitForIdle()

    const vault = await this.readVault().catch(() => null)
    if (!vault) return {}

    const secrets: Record<string, StorageV2PlaintextSecretVaultEntry> = {}
    for (const [secretId, record] of Object.entries(vault.secrets)) {
      if (record.encoding !== LOCAL_VAULT_ENCODING) continue

      const value = await this.decryptLocal(record).catch(() => null)
      if (value == null) continue

      secrets[secretId] = {
        value,
        updatedAt: record.updatedAt
      }
    }

    return secrets
  }

  async importPlaintextSecrets(
    secrets: Record<string, StorageV2PlaintextSecretVaultEntry>
  ): Promise<StorageV2SecretVaultImportResult> {
    const entries = Object.entries(secrets).filter(
      ([secretId, entry]) =>
        Boolean(secretId) &&
        entry &&
        typeof entry.value === 'string' &&
        typeof entry.updatedAt === 'string' &&
        entry.updatedAt
    )
    if (entries.length === 0) {
      return {
        importedCount: 0,
        skippedCount: 0
      }
    }

    return this.enqueueVaultWrite(async () => {
      const vault = await this.readVault()
      let importedCount = 0
      let skippedCount = 0

      for (const [secretId, entry] of entries) {
        const existing = vault.secrets[secretId]
        const existingUpdatedAt = parseUpdatedAt(existing?.updatedAt)
        const nextUpdatedAt = parseUpdatedAt(entry.updatedAt)

        if (existing && existingUpdatedAt >= nextUpdatedAt) {
          skippedCount += 1
          continue
        }

        const encrypted = await this.encryptLocal(entry.value)
        vault.secrets[secretId] = {
          ...encrypted,
          encoding: LOCAL_VAULT_ENCODING,
          updatedAt: entry.updatedAt
        }
        importedCount += 1
      }

      if (importedCount > 0) {
        await this.writeVault(vault)
      }

      return {
        importedCount,
        skippedCount
      }
    })
  }

  async pruneUnreferencedSecretIds(referencedSecretIds: Iterable<string>): Promise<StorageV2SecretVaultPruneResult> {
    const referenced = new Set(referencedSecretIds)

    return this.enqueueVaultWrite(async () => {
      const vault = await this.readVault()
      const secretIds = Object.keys(vault.secrets)
      const prunedSecretIds = secretIds.filter((secretId) => !referenced.has(secretId))

      if (prunedSecretIds.length === 0) {
        return {
          beforeCount: secretIds.length,
          afterCount: secretIds.length,
          prunedCount: 0,
          prunedSecretIds: []
        }
      }

      for (const secretId of prunedSecretIds) {
        delete vault.secrets[secretId]
      }

      await this.writeVault(vault)

      return {
        beforeCount: secretIds.length,
        afterCount: secretIds.length - prunedSecretIds.length,
        prunedCount: prunedSecretIds.length,
        prunedSecretIds
      }
    })
  }

  private getVaultPath() {
    const rootInfo = storageV2DataRootService.ensureDataRoot()
    return path.join(rootInfo.dataRoot, 'secrets', 'vault.json')
  }

  private getMasterKeyPath() {
    const rootInfo = storageV2DataRootService.ensureDataRoot()
    return path.join(rootInfo.dataRoot, 'secrets', 'master.key')
  }

  private async getMasterKey(): Promise<Buffer> {
    const keyPath = this.getMasterKeyPath()
    if (this.masterKey && this.masterKeyPath === keyPath) return this.masterKey

    const key = await fs
      .readFile(keyPath, 'utf-8')
      .then((raw) => Buffer.from(raw.trim(), 'base64'))
      .catch(async (error) => {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }

        const generated = randomBytes(MASTER_KEY_BYTE_LENGTH)
        const tempPath = `${keyPath}.${process.pid}.${Date.now()}.tmp`
        await fs.mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 })
        await fs.writeFile(tempPath, `${generated.toString('base64')}\n`, { mode: 0o600 })
        await fs.rename(tempPath, keyPath)
        await fs.chmod(keyPath, 0o600).catch(() => undefined)
        return generated
      })

    if (key.length !== MASTER_KEY_BYTE_LENGTH) {
      throw new Error('Storage v2 secret vault master key is invalid')
    }

    this.masterKey = key
    this.masterKeyPath = keyPath
    return key
  }

  private async encryptLocal(value: string): Promise<{ encrypted: string; iv: string; authTag: string }> {
    const key = await this.getMasterKey()
    const iv = randomBytes(GCM_IV_BYTE_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()])

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    }
  }

  private async decryptLocal(record: SecretVaultFile['secrets'][string]): Promise<string | null> {
    if (!record.iv || !record.authTag) return null

    const key = await this.getMasterKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(record.encrypted, 'base64')), decipher.final()]).toString('utf-8')
  }

  private async readVault(): Promise<SecretVaultFile> {
    const vaultPath = this.getVaultPath()
    try {
      const raw = await fs.readFile(vaultPath, 'utf-8')
      const parsed = JSON.parse(raw) as SecretVaultFile
      if (parsed.version === VAULT_VERSION && parsed.secrets && typeof parsed.secrets === 'object') {
        return parsed
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return {
          version: VAULT_VERSION,
          secrets: {}
        }
      }

      throw new Error('Storage v2 secret vault is unreadable or invalid')
    }

    throw new Error('Storage v2 secret vault is invalid')
  }

  private async writeVault(vault: SecretVaultFile) {
    const vaultPath = this.getVaultPath()
    const tempPath = `${vaultPath}.${process.pid}.${Date.now()}.tmp`
    await fs.mkdir(path.dirname(vaultPath), { recursive: true, mode: 0o700 })
    await fs.writeFile(tempPath, JSON.stringify(vault, null, 2), { mode: 0o600 })
    await fs.rename(tempPath, vaultPath)
    await fs.chmod(vaultPath, 0o600).catch(() => undefined)
  }

  private async enqueueVaultWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.catch(() => undefined)
    return result
  }
}

function safeDecodeSecretRef(secretRef: string) {
  try {
    return decodeSecretRef(secretRef)
  } catch {
    return null
  }
}

export const storageV2SecretVaultService = new StorageV2SecretVaultService()
