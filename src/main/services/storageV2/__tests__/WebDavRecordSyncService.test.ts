import { createHash } from 'node:crypto'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dbClient: {
    execute: vi.fn()
  },
  remoteFiles: new Map<string, unknown>(),
  webdav: {
    exists: vi.fn(),
    stat: vi.fn(),
    createDirectory: vi.fn(),
    getFileContents: vi.fn(),
    putFileContents: vi.fn(),
    getDirectoryContents: vi.fn(),
    deleteFile: vi.fn()
  },
  secretVault: {
    exportPlaintextSecrets: vi.fn(),
    importPlaintextSecrets: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: {
    getClient: vi.fn(async () => mocks.dbClient)
  }
}))

vi.mock('../DataRootService', () => ({
  storageV2DataRootService: {
    ensureDataRoot: vi.fn(() => ({ dataRoot: '/tmp/cherry-studio-pi-test-data' }))
  }
}))

vi.mock('../SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

import { storageV2Database } from '../StorageV2Database'
import { encodeStorageV2CompositeEntityId } from '../SyncEntityId'
import { StorageV2WebDavRecordSyncService } from '../WebDavRecordSyncService'

const settingsTable = {
  entityType: 'settings',
  table: 'settings',
  idColumns: ['key'],
  updatedAtColumn: 'updated_at',
  deletedAtColumn: 'deleted_at',
  versionColumn: 'version'
} as const

const providerCredentialTable = {
  entityType: 'provider_credential',
  table: 'provider_credentials',
  idColumns: ['provider_id', 'credential_kind'],
  updatedAtColumn: 'updated_at'
} as const

const agentSkillTable = {
  entityType: 'agent_skill',
  table: 'agent_skills',
  idColumns: ['agent_id', 'skill_id'],
  updatedAtColumn: 'updated_at'
} as const

const skillTable = {
  entityType: 'skill',
  table: 'skills',
  idColumns: ['id'],
  updatedAtColumn: 'updated_at',
  deletedAtColumn: 'deleted_at',
  versionColumn: 'version'
} as const

const tombstoneTable = {
  entityType: 'sync_tombstone',
  table: 'sync_tombstones',
  idColumns: ['entity_type', 'entity_id'],
  updatedAtColumn: 'deleted_at',
  versionColumn: 'version'
} as const

const taskRunLogTable = {
  entityType: 'task_run_log',
  table: 'task_run_logs',
  idColumns: ['id'],
  syncIdColumns: ['task_id', 'run_at'],
  updatedAtColumn: 'run_at',
  versionColumn: 'version',
  omitColumnsFromSync: ['id']
} as const

const blobTable = {
  entityType: 'blob',
  table: 'blobs',
  idColumns: ['id'],
  updatedAtColumn: 'updated_at',
  deletedAtColumn: 'deleted_at',
  versionColumn: 'version',
  blobStoragePathColumn: 'storage_path',
  blobChecksumColumn: 'checksum'
} as const

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key])
      return result
    }, {})
}

function hashJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

type SettingsRow = {
  key: string
  value_json: string
  scope: string
  updated_at: string
  deleted_at: string | null
  version: number
}

type ProviderCredentialRow = {
  provider_id: string
  credential_kind: string
  secret_ref: string
  updated_at: string
  updated_by_device_id: string | null
}

type AgentSkillRow = {
  agent_id: string
  skill_id: string
  enabled: number
  created_at: string
  updated_at: string
}

type SkillRow = {
  id: string
  name: string
  description: string | null
  folder_name: string
  source: string
  source_url: string | null
  namespace: string | null
  author: string | null
  tags_json: string | null
  content_hash: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
}

type TombstoneRow = {
  entity_type: string
  entity_id: string
  deleted_at: string
  device_id: string
  version: number
}

type BlobRow = {
  id: string
  storage_path: string
  checksum: string
  byte_size: number
  mime_type: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
}

function makeSettingsDb(rows: SettingsRow[]) {
  const state = {
    rows: [...rows],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (sql.includes('SELECT * FROM settings')) {
          return { rows: state.rows.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(settings)')) {
          return {
            rows: [
              { name: 'key' },
              { name: 'value_json' },
              { name: 'scope' },
              { name: 'updated_at' },
              { name: 'deleted_at' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO settings')) {
          const nextRow: SettingsRow = {
            key: String(args[0]),
            value_json: String(args[1]),
            scope: String(args[2]),
            updated_at: String(args[3]),
            deleted_at: args[4] == null ? null : String(args[4]),
            version: Number(args[5])
          }
          const index = state.rows.findIndex((row) => row.key === nextRow.key)
          if (index === -1) {
            state.rows.push(nextRow)
          } else {
            state.rows[index] = nextRow
          }
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeProviderCredentialDb(input: { credentials?: ProviderCredentialRow[]; tombstones?: TombstoneRow[] }) {
  const state = {
    credentials: [...(input.credentials ?? [])],
    tombstones: [...(input.tombstones ?? [])],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (/SELECT\b/i.test(sql) && sql.includes('FROM provider_credentials')) {
          return { rows: state.credentials.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT * FROM sync_tombstones')) {
          return { rows: state.tombstones.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT deleted_at') && sql.includes('FROM sync_tombstones')) {
          const entityIds = new Set(args.slice(1).map(String))
          const row = state.tombstones.find(
            (item) => item.entity_type === String(args[0]) && entityIds.has(item.entity_id)
          )
          return { rows: row ? [{ deleted_at: row.deleted_at }] : [] }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(provider_credentials)')) {
          return {
            rows: [
              { name: 'provider_id' },
              { name: 'credential_kind' },
              { name: 'secret_ref' },
              { name: 'updated_at' },
              { name: 'updated_by_device_id' }
            ]
          }
        }

        if (sql.includes('PRAGMA table_info(sync_tombstones)')) {
          return {
            rows: [
              { name: 'entity_type' },
              { name: 'entity_id' },
              { name: 'deleted_at' },
              { name: 'device_id' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO provider_credentials')) {
          const nextRow: ProviderCredentialRow = {
            provider_id: String(args[0]),
            credential_kind: String(args[1]),
            secret_ref: String(args[2]),
            updated_at: String(args[3]),
            updated_by_device_id: args[4] == null ? null : String(args[4])
          }
          const index = state.credentials.findIndex(
            (row) => row.provider_id === nextRow.provider_id && row.credential_kind === nextRow.credential_kind
          )
          if (index === -1) {
            state.credentials.push(nextRow)
          } else {
            state.credentials[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('INSERT INTO sync_tombstones')) {
          const nextRow: TombstoneRow = {
            entity_type: String(args[0]),
            entity_id: String(args[1]),
            deleted_at: String(args[2]),
            device_id: String(args[3]),
            version: Number(args[4])
          }
          const index = state.tombstones.findIndex(
            (row) => row.entity_type === nextRow.entity_type && row.entity_id === nextRow.entity_id
          )
          if (index === -1) {
            state.tombstones.push(nextRow)
          } else {
            state.tombstones[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('DELETE FROM provider_credentials')) {
          const [providerId, credentialKind] = args.map(String)
          state.credentials = state.credentials.filter(
            (row) => !(row.provider_id === providerId && row.credential_kind === credentialKind)
          )
          return { rows: [] }
        }

        if (sql.includes('DELETE FROM sync_tombstones')) {
          const [entityType, entityId] = args.map(String)
          state.tombstones = state.tombstones.filter(
            (row) => !(row.entity_type === entityType && row.entity_id === entityId)
          )
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeAgentSkillDb(input: { agentSkills?: AgentSkillRow[]; tombstones?: TombstoneRow[] }) {
  const state = {
    agentSkills: [...(input.agentSkills ?? [])],
    tombstones: [...(input.tombstones ?? [])],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (sql.includes('SELECT * FROM agent_skills')) {
          return { rows: state.agentSkills.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT * FROM sync_tombstones')) {
          return { rows: state.tombstones.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT deleted_at') && sql.includes('FROM sync_tombstones')) {
          const entityIds = new Set(args.slice(1).map(String))
          const row = state.tombstones.find(
            (item) => item.entity_type === String(args[0]) && entityIds.has(item.entity_id)
          )
          return { rows: row ? [{ deleted_at: row.deleted_at }] : [] }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(agent_skills)')) {
          return {
            rows: [
              { name: 'agent_id' },
              { name: 'skill_id' },
              { name: 'enabled' },
              { name: 'created_at' },
              { name: 'updated_at' }
            ]
          }
        }

        if (sql.includes('PRAGMA table_info(sync_tombstones)')) {
          return {
            rows: [
              { name: 'entity_type' },
              { name: 'entity_id' },
              { name: 'deleted_at' },
              { name: 'device_id' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO agent_skills')) {
          const nextRow: AgentSkillRow = {
            agent_id: String(args[0]),
            skill_id: String(args[1]),
            enabled: Number(args[2]),
            created_at: String(args[3]),
            updated_at: String(args[4])
          }
          const index = state.agentSkills.findIndex(
            (row) => row.agent_id === nextRow.agent_id && row.skill_id === nextRow.skill_id
          )
          if (index === -1) {
            state.agentSkills.push(nextRow)
          } else {
            state.agentSkills[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('INSERT INTO sync_tombstones')) {
          const nextRow: TombstoneRow = {
            entity_type: String(args[0]),
            entity_id: String(args[1]),
            deleted_at: String(args[2]),
            device_id: String(args[3]),
            version: Number(args[4])
          }
          const index = state.tombstones.findIndex(
            (row) => row.entity_type === nextRow.entity_type && row.entity_id === nextRow.entity_id
          )
          if (index === -1) {
            state.tombstones.push(nextRow)
          } else {
            state.tombstones[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('DELETE FROM agent_skills')) {
          const [agentId, skillId] = args.map(String)
          state.agentSkills = state.agentSkills.filter((row) => !(row.agent_id === agentId && row.skill_id === skillId))
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeSkillAliasDb(input: { skills?: SkillRow[]; agentSkills?: AgentSkillRow[]; tombstones?: TombstoneRow[] }) {
  const state = {
    skills: [...(input.skills ?? [])],
    agentSkills: [...(input.agentSkills ?? [])],
    tombstones: [...(input.tombstones ?? [])],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (sql.includes('SELECT * FROM skills')) {
          return { rows: state.skills.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT * FROM agent_skills')) {
          return { rows: state.agentSkills.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT * FROM sync_tombstones')) {
          return { rows: state.tombstones.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT id FROM skills WHERE folder_name')) {
          const row = state.skills.find((item) => item.folder_name === String(args[0]))
          return { rows: row ? [{ id: row.id }] : [] }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(skills)')) {
          return {
            rows: [
              { name: 'id' },
              { name: 'name' },
              { name: 'description' },
              { name: 'folder_name' },
              { name: 'source' },
              { name: 'source_url' },
              { name: 'namespace' },
              { name: 'author' },
              { name: 'tags_json' },
              { name: 'content_hash' },
              { name: 'created_at' },
              { name: 'updated_at' },
              { name: 'deleted_at' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('PRAGMA table_info(agent_skills)')) {
          return {
            rows: [
              { name: 'agent_id' },
              { name: 'skill_id' },
              { name: 'enabled' },
              { name: 'created_at' },
              { name: 'updated_at' }
            ]
          }
        }

        if (sql.includes('PRAGMA table_info(sync_tombstones)')) {
          return {
            rows: [
              { name: 'entity_type' },
              { name: 'entity_id' },
              { name: 'deleted_at' },
              { name: 'device_id' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO skills')) {
          const nextRow: SkillRow = {
            id: String(args[0]),
            name: String(args[1]),
            description: args[2] == null ? null : String(args[2]),
            folder_name: String(args[3]),
            source: String(args[4]),
            source_url: args[5] == null ? null : String(args[5]),
            namespace: args[6] == null ? null : String(args[6]),
            author: args[7] == null ? null : String(args[7]),
            tags_json: args[8] == null ? null : String(args[8]),
            content_hash: args[9] == null ? null : String(args[9]),
            created_at: String(args[10]),
            updated_at: String(args[11]),
            deleted_at: args[12] == null ? null : String(args[12]),
            version: Number(args[13])
          }
          const duplicate = state.skills.find((row) => row.folder_name === nextRow.folder_name && row.id !== nextRow.id)
          if (duplicate) {
            throw new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: skills.folder_name')
          }

          const index = state.skills.findIndex((row) => row.id === nextRow.id)
          if (index === -1) {
            state.skills.push(nextRow)
          } else {
            state.skills[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('INSERT INTO agent_skills')) {
          const nextRow: AgentSkillRow = {
            agent_id: String(args[0]),
            skill_id: String(args[1]),
            enabled: Number(args[2]),
            created_at: String(args[3]),
            updated_at: String(args[4])
          }
          const index = state.agentSkills.findIndex(
            (row) => row.agent_id === nextRow.agent_id && row.skill_id === nextRow.skill_id
          )
          if (index === -1) {
            state.agentSkills.push(nextRow)
          } else {
            state.agentSkills[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('INSERT INTO sync_tombstones')) {
          const nextRow: TombstoneRow = {
            entity_type: String(args[0]),
            entity_id: String(args[1]),
            deleted_at: String(args[2]),
            device_id: String(args[3]),
            version: Number(args[4])
          }
          const index = state.tombstones.findIndex(
            (row) => row.entity_type === nextRow.entity_type && row.entity_id === nextRow.entity_id
          )
          if (index === -1) {
            state.tombstones.push(nextRow)
          } else {
            state.tombstones[index] = nextRow
          }
          return { rows: [] }
        }

        if (sql.includes('DELETE FROM agent_skills')) {
          const [agentId, skillId] = args.map(String)
          state.agentSkills = state.agentSkills.filter((row) => !(row.agent_id === agentId && row.skill_id === skillId))
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeBlobDb(input: { blobs?: BlobRow[] } = {}) {
  const state = {
    blobs: [...(input.blobs ?? [])],
    syncState: new Map<string, string>()
  }

  return {
    state,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === 'string' ? input : input.sql
        const args = typeof input === 'string' ? [] : (input.args ?? [])

        if (sql.includes('SELECT * FROM blobs')) {
          return { rows: state.blobs.map((row) => ({ ...row })) }
        }

        if (sql.includes('SELECT value_json FROM sync_state')) {
          const value = state.syncState.get(String(args[0]))
          return { rows: value ? [{ value_json: JSON.stringify(value) }] : [] }
        }

        if (sql.includes('INSERT INTO sync_state')) {
          state.syncState.set(String(args[0]), JSON.parse(String(args[1])))
          return { rows: [] }
        }

        if (sql.includes('PRAGMA table_info(blobs)')) {
          return {
            rows: [
              { name: 'id' },
              { name: 'storage_path' },
              { name: 'checksum' },
              { name: 'byte_size' },
              { name: 'mime_type' },
              { name: 'created_at' },
              { name: 'updated_at' },
              { name: 'deleted_at' },
              { name: 'version' }
            ]
          }
        }

        if (sql.includes('INSERT INTO blobs')) {
          const nextRow: BlobRow = {
            id: String(args[0]),
            storage_path: String(args[1]),
            checksum: String(args[2]),
            byte_size: Number(args[3]),
            mime_type: args[4] == null ? null : String(args[4]),
            created_at: String(args[5]),
            updated_at: String(args[6]),
            deleted_at: args[7] == null ? null : String(args[7]),
            version: Number(args[8])
          }
          const index = state.blobs.findIndex((row) => row.id === nextRow.id)
          if (index === -1) {
            state.blobs.push(nextRow)
          } else {
            state.blobs[index] = nextRow
          }
          return { rows: [] }
        }

        return { rows: [] }
      })
    }
  }
}

function makeSharedWebDavStore() {
  const files = new Map<string, unknown>()
  const fileSize = (filePath: string) => {
    const value = files.get(filePath)
    if (Buffer.isBuffer(value)) return value.byteLength
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
    if (value instanceof ArrayBuffer) return value.byteLength
    return value == null ? 0 : Buffer.byteLength(String(value), 'utf8')
  }
  return {
    files,
    client: {
      exists: vi.fn(async (filePath: string) => {
        const normalized = path.posix.normalize(filePath).replace(/\/+$/g, '')
        return Array.from(files.keys()).some((key) => {
          const value = path.posix.normalize(String(key))
          return value === normalized || value.startsWith(`${normalized}/`)
        })
      }),
      stat: vi.fn(async (filePath: string) => ({ size: fileSize(filePath) })),
      createDirectory: vi.fn(async () => undefined),
      getFileContents: vi.fn(async (filePath: string) => {
        if (!files.has(filePath)) {
          throw new Error(`Missing remote file: ${filePath}`)
        }
        return files.get(filePath)
      }),
      putFileContents: vi.fn(async (filePath: string, contents: unknown, options?: any) => {
        if (options?.overwrite === false && files.has(filePath)) {
          return false
        }
        files.set(filePath, contents)
        return true
      }),
      deleteFile: vi.fn(async (filePath: string) => {
        files.delete(filePath)
        const normalized = path.posix.normalize(filePath).replace(/\/+$/g, '')
        for (const key of Array.from(files.keys())) {
          const remotePath = path.posix.normalize(String(key))
          if (remotePath.startsWith(`${normalized}/`)) {
            files.delete(key)
          }
        }
        return true
      }),
      getDirectoryContents: vi.fn(async (filePath: string) => {
        const normalized = path.posix.normalize(filePath).replace(/\/+$/g, '')
        const prefix = `${normalized}/`
        const discoveredDirectories = new Set<string>()
        const entries = new Set<{
          filename: string
          basename: string
          type: 'directory' | 'file'
        }>()

        for (const key of files.keys()) {
          const file = path.posix.normalize(String(key))
          if (file === normalized) continue
          if (!file.startsWith(prefix)) continue

          const relative = file.slice(prefix.length)
          const parts = relative.split('/')
          if (!parts[0]) continue

          if (parts.length === 1) {
            entries.add({
              filename: file,
              basename: parts[0],
              type: 'file'
            })
            continue
          }

          const dirPath = `${normalized}/${parts[0]}`
          if (discoveredDirectories.has(dirPath)) continue
          discoveredDirectories.add(dirPath)
          entries.add({
            filename: dirPath,
            basename: parts[0],
            type: 'directory'
          })
        }

        return Array.from(entries)
      })
    }
  }
}

const HASHED_BUNDLE_PATH = /^storage-v2\/bundle\/[a-f0-9]{64}\.json$/
const HASHED_SECRET_PATH = /^storage-v2\/secrets\/[a-f0-9]{64}\.json$/

function hasRemoteFile(remote: ReturnType<typeof makeSharedWebDavStore>, pattern: RegExp) {
  return Array.from(remote.files.keys()).some((filePath) => pattern.test(filePath))
}

describe('StorageV2WebDavRecordSyncService', () => {
  beforeEach(() => {
    mocks.dbClient.execute.mockReset()
    mocks.webdav.exists.mockReset()
    mocks.webdav.stat.mockReset()
    mocks.webdav.createDirectory.mockReset()
    mocks.webdav.getFileContents.mockReset()
    mocks.webdav.putFileContents.mockReset()
    mocks.webdav.getDirectoryContents.mockReset()
    mocks.webdav.deleteFile.mockReset()
    mocks.secretVault.exportPlaintextSecrets.mockReset()
    mocks.secretVault.importPlaintextSecrets.mockReset()
    vi.mocked(storageV2Database.getClient).mockReset()
    vi.mocked(storageV2Database.getClient).mockImplementation(async () => mocks.dbClient as any)
    mocks.remoteFiles.clear()
    mocks.webdav.exists.mockImplementation(async (filePath: string) => {
      if (mocks.remoteFiles.has(filePath)) return true
      return true
    })
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      const value = mocks.remoteFiles.get(filePath)
      if (Buffer.isBuffer(value)) return { size: value.byteLength }
      if (typeof value === 'string') return { size: Buffer.byteLength(value, 'utf8') }
      if (value instanceof ArrayBuffer) return { size: value.byteLength }
      return { size: value == null ? 0 : Buffer.byteLength(String(value), 'utf8') }
    })
    mocks.webdav.createDirectory.mockResolvedValue(undefined)
    mocks.webdav.putFileContents.mockImplementation(async (filePath: string, contents: unknown, options?: any) => {
      if (options?.overwrite === false && mocks.remoteFiles.has(filePath)) {
        return false
      }
      mocks.remoteFiles.set(filePath, contents)
      return true
    })
    mocks.webdav.getFileContents.mockImplementation(async (filePath: string) => mocks.remoteFiles.get(filePath) ?? '')
    mocks.webdav.deleteFile.mockImplementation(async (filePath: string) => {
      mocks.remoteFiles.delete(filePath)
      const normalized = path.posix.normalize(filePath).replace(/\/+$/g, '')
      for (const key of Array.from(mocks.remoteFiles.keys())) {
        const remotePath = path.posix.normalize(String(key))
        if (remotePath.startsWith(`${normalized}/`)) {
          mocks.remoteFiles.delete(key)
        }
      }
    })
    mocks.webdav.getDirectoryContents.mockResolvedValue([])
    mocks.secretVault.exportPlaintextSecrets.mockResolvedValue({})
    mocks.secretVault.importPlaintextSecrets.mockResolvedValue({ importedCount: 0, skippedCount: 0 })
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('SELECT value_json FROM sync_state')) {
        return { rows: [] }
      }

      if (sql.includes('INSERT INTO sync_state')) {
        return { rows: [] }
      }

      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }

      if (sql.includes('INSERT INTO settings')) {
        return { rows: [] }
      }

      return { rows: [] }
    })
  })

  it('fails before syncing when the WebDAV path cannot delete probe files', async () => {
    const remote = makeSharedWebDavStore()
    remote.client.deleteFile.mockRejectedValueOnce(new Error('delete denied'))

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {}
      })
    ).rejects.toThrow('WebDAV request failed while deleting Storage v2 sync probe')

    expect(remote.client.putFileContents).toHaveBeenCalledWith(
      expect.stringContaining('/remote-root/sync/v1/.cherry-studio-pi-storage-write-test-'),
      'ok',
      { overwrite: true }
    )
  })

  it('fails before syncing when the WebDAV client cannot delete remote files', async () => {
    const remote = makeSharedWebDavStore()
    const client = { ...remote.client }
    delete (client as any).deleteFile

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {}
      })
    ).rejects.toThrow('当前 WebDAV 客户端不支持删除远端文件')
  })

  it('fails clearly before upload when a local record is too large for WebDAV sync', async () => {
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return {
          rows: [
            {
              key: 'oversized-log',
              value_json: JSON.stringify({ output: 'x'.repeat(2 * 1024 * 1024) }),
              scope: 'data-sync-test',
              updated_at: '2026-05-29T12:00:00.000Z',
              deleted_at: null,
              version: 1
            }
          ]
        }
      }
      if (sql.includes('SELECT value_json FROM sync_state')) return { rows: [] }
      if (sql.includes('INSERT INTO sync_state')) return { rows: [] }
      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }
      return { rows: [] }
    })

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(mocks.webdav as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {}
      })
    ).rejects.toThrow('记录过大')

    expect(mocks.webdav.putFileContents).not.toHaveBeenCalledWith(
      expect.stringContaining('/storage-v2/bundle/'),
      expect.anything(),
      expect.anything()
    )
  })

  it('syncs task run logs by natural identity instead of local autoincrement ids', async () => {
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM task_run_logs')) {
        return {
          rows: [
            {
              id: 1,
              task_id: 'task-1',
              session_id: 'session-1',
              run_at: '2026-05-29T12:00:00.000Z',
              duration_ms: 123,
              status: 'success',
              result_json: '{"ok":true}',
              error: null,
              version: 2
            }
          ]
        }
      }
      if (sql.includes('SELECT value_json FROM sync_state')) return { rows: [] }
      if (sql.includes('INSERT INTO sync_state')) return { rows: [] }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([taskRunLogTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      null
    )
    const recordId = 'task_run_log:task-1:2026-05-29T12%3A00%3A00.000Z'
    const bundlePath = `/remote-root/sync/v1/${result.manifest.bundle?.path}`
    const bundle = JSON.parse(String(mocks.remoteFiles.get(bundlePath)))

    expect(result.manifest.records[recordId]).toMatchObject({
      entityType: 'task_run_log',
      idValues: ['task-1', '2026-05-29T12:00:00.000Z'],
      path: expect.stringMatching(HASHED_BUNDLE_PATH)
    })
    expect(bundle.records[recordId].row).toMatchObject({
      task_id: 'task-1',
      run_at: '2026-05-29T12:00:00.000Z',
      status: 'success'
    })
    expect(bundle.records[recordId].row).not.toHaveProperty('id')
  })

  it('imports remote task run logs without overwriting a different local autoincrement row', async () => {
    const remoteRow = {
      task_id: 'remote-task',
      session_id: 'remote-session',
      run_at: '2026-05-29T12:30:00.000Z',
      duration_ms: 321,
      status: 'success',
      result_json: '{"remote":true}',
      error: null,
      version: 1
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'task_run_log:remote-task:2026-05-29T12%3A30%3A00.000Z',
      table: taskRunLogTable,
      idValues: ['remote-task', '2026-05-29T12:30:00.000Z'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.run_at),
      deletedAt: null,
      version: 1
    }
    mocks.remoteFiles.set(
      '/remote-root/sync/v1/storage-v2/records/task_run_log/remote.json',
      JSON.stringify(remoteRecord)
    )

    const executed: Array<string | { sql: string; args?: unknown[] }> = []
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string; args?: unknown[] }) => {
      executed.push(input)
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM task_run_logs')) {
        return {
          rows: [
            {
              id: 1,
              task_id: 'local-task',
              session_id: 'local-session',
              run_at: '2026-05-29T12:00:00.000Z',
              duration_ms: 111,
              status: 'success',
              result_json: '{"local":true}',
              error: null,
              version: 1
            }
          ]
        }
      }
      if (sql.includes('PRAGMA table_info(task_run_logs)')) {
        return {
          rows: [
            { name: 'id' },
            { name: 'task_id' },
            { name: 'session_id' },
            { name: 'run_at' },
            { name: 'duration_ms' },
            { name: 'status' },
            { name: 'result_json' },
            { name: 'error' },
            { name: 'version' }
          ]
        }
      }
      if (sql.includes('SELECT id FROM task_run_logs WHERE task_id = ? AND run_at = ?')) {
        return { rows: [] }
      }
      if (sql.includes('SELECT value_json FROM sync_state')) return { rows: [] }
      if (sql.includes('INSERT INTO sync_state')) return { rows: [] }
      return { rows: [] }
    })

    await new StorageV2WebDavRecordSyncService([taskRunLogTable]).sync(mocks.webdav as any, '/remote-root/sync/v1', {
      version: 1,
      blobs: {},
      records: {
        [remoteRecord.id]: {
          entityType: 'task_run_log',
          table: 'task_run_logs',
          idValues: remoteRecord.idValues,
          valueHash: remoteHash,
          updatedAt: Date.parse(remoteRow.run_at),
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/task_run_log/remote.json'
        }
      }
    })

    const insert = executed.find(
      (entry) => typeof entry !== 'string' && entry.sql.includes('INSERT INTO task_run_logs')
    ) as { sql: string; args?: unknown[] } | undefined
    expect(insert?.sql).not.toContain('(id,')
    expect(insert?.sql).toContain('task_id')
    expect(insert?.args).toEqual([
      'remote-task',
      'remote-session',
      '2026-05-29T12:30:00.000Z',
      321,
      'success',
      '{"remote":true}',
      null,
      1
    ])
  })

  it('uploads local Storage v2 rows as WebDAV records', async () => {
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return {
          rows: [
            {
              key: 'theme',
              value_json: '{"mode":"dark"}',
              scope: 'app',
              updated_at: '2026-05-29T12:00:00.000Z',
              deleted_at: null,
              version: 1
            }
          ]
        }
      }
      if (sql.includes('SELECT value_json FROM sync_state') || sql.includes('INSERT INTO sync_state')) {
        return { rows: [] }
      }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      null
    )

    expect(result.summary.storageUploaded).toBe(1)
    expect(result.manifest.records['settings:theme']).toEqual(
      expect.objectContaining({
        entityType: 'settings',
        table: 'settings',
        idValues: ['theme'],
        path: expect.stringMatching(HASHED_BUNDLE_PATH)
      })
    )
    expect(result.manifest.bundle).toEqual(
      expect.objectContaining({
        path: expect.stringMatching(HASHED_BUNDLE_PATH),
        recordCount: 1,
        blobCount: 0
      })
    )
    expect(mocks.webdav.putFileContents).toHaveBeenCalledWith(
      expect.stringMatching(/\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/),
      expect.stringContaining('"key": "theme"'),
      { overwrite: false }
    )
  })

  it('publishes many Storage v2 rows as one content-addressed bundle instead of many record files', async () => {
    const remote = makeSharedWebDavStore()
    const db = makeSettingsDb([
      {
        key: 'theme',
        value_json: '{"mode":"dark"}',
        scope: 'app',
        updated_at: '2026-05-29T12:00:00.000Z',
        deleted_at: null,
        version: 1
      },
      {
        key: 'language',
        value_json: '{"locale":"zh-CN"}',
        scope: 'app',
        updated_at: '2026-05-29T12:01:00.000Z',
        deleted_at: null,
        version: 1
      }
    ])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      null
    )

    const bundleFiles = Array.from(remote.files.keys()).filter((filePath) =>
      /^\/remote-root\/sync\/v1\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/.test(filePath)
    )
    const recordFiles = Array.from(remote.files.keys()).filter((filePath) => filePath.includes('/storage-v2/records/'))

    expect(result.summary.storageUploaded).toBe(2)
    expect(result.manifest.bundle).toEqual(
      expect.objectContaining({
        path: expect.stringMatching(HASHED_BUNDLE_PATH),
        recordCount: 2,
        blobCount: 0
      })
    )
    expect(bundleFiles).toHaveLength(1)
    expect(recordFiles).toHaveLength(0)
  })

  it('rejects oversized remote Storage v2 bundles before downloading them', async () => {
    const bundlePath = '/remote-root/sync/v1/storage-v2/bundle/oversized.json'
    mocks.remoteFiles.set(bundlePath, JSON.stringify({ version: 1, updatedAt: 0, records: {}, blobs: {} }))
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      if (filePath === bundlePath) return { size: 129 * 1024 * 1024 }
      const value = mocks.remoteFiles.get(filePath)
      return { size: typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0 }
    })

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(mocks.webdav as any, '/remote-root/sync/v1', {
        version: 1,
        records: {},
        blobs: {},
        bundle: {
          version: 1,
          path: 'storage-v2/bundle/oversized.json',
          valueHash: 'expected-bundle-hash',
          recordCount: 0,
          blobCount: 0,
          updatedAt: 0
        }
      })
    ).rejects.toThrow('远端 Storage v2 记录包过大')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(bundlePath, expect.anything())
  })

  it('fails safe when the remote Storage v2 bundle hash does not match the manifest', async () => {
    const remote = makeSharedWebDavStore()
    const corruptBundlePath = '/remote-root/sync/v1/storage-v2/bundle/corrupt.json'
    remote.files.set(
      corruptBundlePath,
      JSON.stringify({
        version: 1,
        updatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
        records: {},
        blobs: {}
      })
    )
    const db = makeSettingsDb([])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {},
        bundle: {
          version: 1,
          path: 'storage-v2/bundle/corrupt.json',
          valueHash: 'expected-bundle-hash',
          recordCount: 0,
          blobCount: 0,
          updatedAt: Date.parse('2026-05-29T12:00:00.000Z')
        }
      })
    ).rejects.toThrow('远端 Storage v2 数据包校验失败')

    expect(hasRemoteFile(remote, /^\/remote-root\/sync\/v1\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/)).toBe(false)
  })

  it('rejects oversized remote Storage v2 secret bundles before downloading them', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const remoteRecord = {
      id: 'provider_credential:provider-1:apiKey',
      table: providerCredentialTable,
      idValues: ['provider-1', 'apiKey'],
      row: credentialRow,
      valueHash: hashJson(credentialRow),
      updatedAt: Date.parse(credentialRow.updated_at),
      deletedAt: null,
      version: 1
    }
    const recordPath = '/remote-root/sync/v1/storage-v2/records/provider_credential/api-key.json'
    const secretPath = '/remote-root/sync/v1/storage-v2/secrets/oversized.json'
    const db = makeProviderCredentialDb({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)
    mocks.remoteFiles.set(recordPath, JSON.stringify(remoteRecord))
    mocks.remoteFiles.set(secretPath, JSON.stringify({ version: 1, updatedAt: 0, secrets: {} }))
    mocks.webdav.stat.mockImplementation(async (filePath: string) => {
      if (filePath === secretPath) return { size: 9 * 1024 * 1024 }
      const value = mocks.remoteFiles.get(filePath)
      return { size: typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0 }
    })

    await expect(
      new StorageV2WebDavRecordSyncService([providerCredentialTable]).sync(
        mocks.webdav as any,
        '/remote-root/sync/v1',
        {
          version: 1,
          blobs: {},
          records: {
            [remoteRecord.id]: {
              entityType: 'provider_credential',
              table: 'provider_credentials',
              idValues: remoteRecord.idValues,
              valueHash: remoteRecord.valueHash,
              updatedAt: remoteRecord.updatedAt,
              deletedAt: null,
              version: 1,
              path: 'storage-v2/records/provider_credential/api-key.json'
            }
          },
          secrets: {
            version: 1,
            path: 'storage-v2/secrets/oversized.json',
            valueHash: 'expected-secret-hash',
            secretCount: 1,
            updatedAt: 0,
            encryption: 'cherry-webdav-secret-sync-aes-256-gcm'
          }
        },
        { secretKeyMaterial: 'dav-user:dav-password' }
      )
    ).rejects.toThrow('远端敏感配置数据包过大')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(secretPath, expect.anything())
    expect(db.state.credentials).toEqual([])
  })

  it('rejects oversized remote Storage v2 blobs before downloading file contents', async () => {
    const blobRow: BlobRow = {
      id: 'blob-1',
      storage_path: 'blobs/blob-1.bin',
      checksum: 'a'.repeat(64),
      byte_size: 64 * 1024 * 1024 + 1,
      mime_type: 'application/octet-stream',
      created_at: '2026-06-01T08:00:00.000Z',
      updated_at: '2026-06-01T08:00:00.000Z',
      deleted_at: null,
      version: 1
    }
    const remoteRecord = {
      id: 'blob:blob-1',
      table: blobTable,
      idValues: ['blob-1'],
      row: blobRow,
      valueHash: hashJson(blobRow),
      updatedAt: Date.parse(blobRow.updated_at),
      deletedAt: null,
      version: 1
    }
    const recordPath = '/remote-root/sync/v1/storage-v2/records/blob/blob-1.json'
    const blobPath = '/remote-root/sync/v1/storage-v2/blobs/blob-1.bin'
    const db = makeBlobDb()
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)
    mocks.remoteFiles.set(recordPath, JSON.stringify(remoteRecord))
    mocks.remoteFiles.set(blobPath, Buffer.from('oversized blob placeholder'))

    await expect(
      new StorageV2WebDavRecordSyncService([blobTable]).sync(mocks.webdav as any, '/remote-root/sync/v1', {
        version: 1,
        records: {
          [remoteRecord.id]: {
            entityType: 'blob',
            table: 'blobs',
            idValues: remoteRecord.idValues,
            valueHash: remoteRecord.valueHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/blob/blob-1.json'
          }
        },
        blobs: {
          'blob-1': {
            id: 'blob-1',
            checksum: blobRow.checksum,
            byteSize: blobRow.byte_size,
            storagePath: blobRow.storage_path,
            path: 'storage-v2/blobs/blob-1.bin',
            updatedAt: remoteRecord.updatedAt
          }
        }
      })
    ).rejects.toThrow('远端附件文件过大')

    expect(mocks.webdav.getFileContents).not.toHaveBeenCalledWith(blobPath, expect.anything())
  })

  it('fails safe when the remote manifest contains records from a newer Storage v2 entity', async () => {
    const remote = makeSharedWebDavStore()
    const db = makeSettingsDb([])
    const remoteRow = { id: 'future-1', value: 'new-shape' }
    const remoteHash = hashJson(remoteRow)
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {
          'future_entity:future-1': {
            entityType: 'future_entity',
            table: 'future_entities',
            idValues: ['future-1'],
            valueHash: remoteHash,
            updatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/future_entity/future-1.json'
          }
        }
      } as any)
    ).rejects.toThrow('不支持的实体：future_entity')

    expect(db.state.rows).toEqual([])
    expect(hasRemoteFile(remote, /^\/remote-root\/sync\/v1\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/)).toBe(false)
  })

  it('fails safe when the remote record bundle contains records from a newer Storage v2 entity', async () => {
    const remote = makeSharedWebDavStore()
    const db = makeSettingsDb([])
    const remoteRow = { id: 'future-1', value: 'new-shape' }
    const updatedAt = Date.parse('2026-05-29T12:00:00.000Z')
    const remoteRecord = {
      id: 'future_entity:future-1',
      table: {
        entityType: 'future_entity',
        table: 'future_entities',
        idColumns: ['id'],
        updatedAtColumn: 'updated_at'
      },
      idValues: ['future-1'],
      row: remoteRow,
      valueHash: hashJson(remoteRow),
      updatedAt,
      deletedAt: null,
      version: 1
    }
    const bundle = {
      version: 1,
      updatedAt,
      records: {
        [remoteRecord.id]: remoteRecord
      },
      blobs: {}
    }
    const bundleValueHash = hashJson({ records: bundle.records, blobs: bundle.blobs })
    remote.files.set('/remote-root/sync/v1/storage-v2/bundle/future.json', JSON.stringify(bundle))
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {},
        bundle: {
          version: 1,
          path: 'storage-v2/bundle/future.json',
          valueHash: bundleValueHash,
          recordCount: 1,
          blobCount: 0,
          updatedAt
        }
      })
    ).rejects.toThrow('数据包包含当前版本不支持的实体：future_entity')

    expect(db.state.rows).toEqual([])
  })

  it('downloads remote Storage v2 rows into the local database', async () => {
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    mocks.remoteFiles.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      }
    )

    const insertCall = mocks.dbClient.execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO settings')
    })

    expect(result.summary.storageDownloaded).toBe(1)
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: ['theme', '{"mode":"light"}', 'app', '2026-05-29T12:10:00.000Z', null, 2]
      })
    )
  })

  it('fails visibly when a known remote Storage v2 row cannot be applied locally', async () => {
    const remote = makeSharedWebDavStore()
    const remoteRow = {}
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))

    const db = makeSettingsDb([])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      })
    ).rejects.toThrow('远端 Storage v2 记录 settings:theme 缺少当前版本可写入的必要字段')

    expect(db.state.rows).toHaveLength(0)
    expect(db.state.syncState.size).toBe(0)
  })

  it('fails safely when record hash metadata is stale', async () => {
    const remote = makeSharedWebDavStore()
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.updated_at),
      deletedAt: null,
      version: 2
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/legacy-theme.json', JSON.stringify(remoteRecord))

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: `${remoteHash}-stale`,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/legacy-theme.json'
          }
        }
      })
    ).rejects.toThrow('远端 Storage v2 记录 settings:theme 校验失败')
  })

  it('fails safely when content-equivalent rows have drifting hash metadata', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.updated_at),
      deletedAt: null,
      version: 2
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/legacy-theme.json', JSON.stringify(remoteRecord))

    const db = makeSettingsDb([localRow])
    db.state.syncState.set('webdav-storage-record:settings:theme:hash', 'historical-baseline')
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([settingsTable]).sync(remote.client as any, '/remote-root/sync/v1', {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: `${remoteHash}-stale`,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/legacy-theme.json'
          }
        }
      })
    ).rejects.toThrow('远端 Storage v2 记录 settings:theme 校验失败')
    expect(db.state.syncState.get('webdav-storage-record:settings:theme:hash')).toBe('historical-baseline')
  })

  it('rewrites a missing remote record referenced by equal hash into bundle-backed manifest', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const localHash = hashJson(localRow)
    const db = makeSettingsDb([localRow])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: localHash,
            updatedAt: Date.parse(localRow.updated_at),
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/missing-theme.json'
          }
        }
      }
    )

    expect(result.summary.storageUploaded).toBe(1)
    expect(result.manifest.records['settings:theme']).toMatchObject({
      entityType: 'settings',
      table: 'settings',
      idValues: ['theme'],
      valueHash: localHash,
      path: expect.stringMatching(HASHED_BUNDLE_PATH)
    })
    expect(hasRemoteFile(remote, /^\/remote-root\/sync\/v1\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/)).toBe(true)
  })

  it('keeps stale remote artifacts during normal sync instead of recursively deleting provider files', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"cleanup"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 3
    }
    const localHash = hashJson(localRow)
    const staleRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: localRow,
      valueHash: localHash,
      updatedAt: Date.parse(localRow.updated_at),
      deletedAt: null,
      version: 1
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/theme-old.json', JSON.stringify(staleRecord))
    remote.files.set('/remote-root/sync/v1/storage-v2/blobs/orphaned.bin', 'orphaned blob')
    remote.files.set('/remote-root/sync/v1/storage-v2/bundle/old.json', 'orphaned bundle')
    remote.files.set('/remote-root/sync/v1/storage-v2/secrets/old.json', 'orphaned secrets')

    const db = makeSettingsDb([localRow])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: localHash,
            updatedAt: Date.parse(localRow.updated_at),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/settings/theme-old.json'
          }
        }
      }
    )

    expect(result.summary.storageUploaded).toBe(0)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/records/settings/theme-old.json')).toBe(true)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/blobs/orphaned.bin')).toBe(true)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/bundle/old.json')).toBe(true)
    expect(hasRemoteFile(remote, /^\/remote-root\/sync\/v1\/storage-v2\/bundle\/[a-f0-9]{64}\.json$/)).toBe(true)
  })

  it('prunes stale remote Storage v2 artifacts after a manifest has been published', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"local"}',
      scope: 'app',
      updated_at: '2026-05-29T12:00:00.000Z',
      deleted_at: null,
      version: 1
    }
    const localHash = hashJson(localRow)
    const staleRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: localRow,
      valueHash: localHash,
      updatedAt: Date.parse(localRow.updated_at),
      deletedAt: null,
      version: 1
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/theme-old.json', JSON.stringify(staleRecord))
    remote.files.set('/remote-root/sync/v1/storage-v2/blobs/orphaned.bin', 'orphaned blob')
    remote.files.set('/remote-root/sync/v1/storage-v2/bundle/old.json', 'orphaned bundle')

    const db = makeSettingsDb([localRow])
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)
    const service = new StorageV2WebDavRecordSyncService([settingsTable])
    const result = await service.sync(remote.client as any, '/remote-root/sync/v1', {
      version: 1,
      blobs: {},
      records: {
        'settings:theme': {
          entityType: 'settings',
          table: 'settings',
          idValues: ['theme'],
          valueHash: localHash,
          updatedAt: Date.parse(localRow.updated_at),
          deletedAt: null,
          version: 1,
          path: 'storage-v2/records/settings/theme-old.json'
        }
      }
    })

    const currentBundlePath = `/remote-root/sync/v1/${result.manifest.bundle?.path}`
    await service.pruneRemoteArtifacts(remote.client as any, '/remote-root/sync/v1', result.manifest)

    expect(remote.client.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/storage-v2/records')
    expect(remote.client.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/storage-v2/blobs')
    expect(remote.client.deleteFile).toHaveBeenCalledWith('/remote-root/sync/v1/storage-v2/secrets')
    expect(remote.files.has(currentBundlePath)).toBe(true)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/records/settings/theme-old.json')).toBe(false)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/blobs/orphaned.bin')).toBe(false)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/bundle/old.json')).toBe(false)
    expect(remote.files.has('/remote-root/sync/v1/storage-v2/secrets/old.json')).toBe(false)
  })

  it('prefers remote Storage v2 rows and keeps a recovery audit when a device has no prior sync baseline', async () => {
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"local-default"}',
      scope: 'app',
      updated_at: '2026-05-29T12:20:00.000Z',
      deleted_at: null,
      version: 3
    }
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"remote-user"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const events: string[] = []
    const beforeRemoteConflictApply = vi.fn(async () => {
      events.push('before-remote-conflict-apply')
    })
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    mocks.remoteFiles.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return { rows: [localRow] }
      }
      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }
      if (sql.includes('INSERT INTO settings')) {
        events.push('insert-settings')
      }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      },
      {
        beforeRemoteConflictApply
      }
    )

    const insertCall = mocks.dbClient.execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO settings')
    })

    expect(result.summary.storageDownloaded).toBe(1)
    expect(result.summary.storageUploaded).toBe(0)
    expect(result.summary.storageConflicts).toBe(0)
    expect(result.summary.storageResolvedConflicts).toBe(1)
    expect(beforeRemoteConflictApply).toHaveBeenCalledWith({
      id: 'settings:theme',
      baseHash: null,
      firstJoin: true
    })
    expect(events).toEqual(['before-remote-conflict-apply', 'insert-settings'])
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: ['theme', '{"mode":"remote-user"}', 'app', '2026-05-29T12:10:00.000Z', null, 2]
      })
    )
    expect(
      mocks.webdav.putFileContents.mock.calls.some(
        ([filePath, contents]) =>
          String(filePath).includes('/storage-v2/records/settings/') && String(contents).includes('local-default')
      )
    ).toBe(false)
    expect(
      mocks.dbClient.execute.mock.calls.some(([input]) => {
        const sql = typeof input === 'string' ? input : input.sql
        return sql.includes('INSERT INTO sync_conflicts')
      })
    ).toBe(true)
  })

  it('hydrates remote Storage v2 rows without per-record conflict audits when joining an existing sync space', async () => {
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"local-default"}',
      scope: 'app',
      updated_at: '2026-05-29T12:20:00.000Z',
      deleted_at: null,
      version: 3
    }
    const remoteRow = {
      key: 'theme',
      value_json: '{"mode":"remote-user"}',
      scope: 'app',
      updated_at: '2026-05-29T12:10:00.000Z',
      deleted_at: null,
      version: 2
    }
    const remoteHash = hashJson(remoteRow)
    const events: string[] = []
    const beforeRemoteConflictApply = vi.fn(async () => {
      events.push('before-remote-conflict-apply')
    })
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse('2026-05-29T12:10:00.000Z'),
      deletedAt: null,
      version: 2
    }
    mocks.remoteFiles.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))
    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (sql.includes('SELECT * FROM settings')) {
        return { rows: [localRow] }
      }
      if (sql.includes('PRAGMA table_info(settings)')) {
        return {
          rows: [
            { name: 'key' },
            { name: 'value_json' },
            { name: 'scope' },
            { name: 'updated_at' },
            { name: 'deleted_at' },
            { name: 'version' }
          ]
        }
      }
      if (sql.includes('INSERT INTO settings')) {
        events.push('insert-settings')
      }
      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      },
      {
        beforeRemoteConflictApply,
        preferRemoteOnFirstJoin: true
      }
    )

    const insertCall = mocks.dbClient.execute.mock.calls.find(([input]) => {
      const sql = typeof input === 'string' ? input : input.sql
      return sql.includes('INSERT INTO settings')
    })

    expect(result.summary.storageDownloaded).toBe(1)
    expect(result.summary.storageUploaded).toBe(0)
    expect(result.summary.storageConflicts).toBe(0)
    expect(result.summary.storageResolvedConflicts).toBe(0)
    expect(beforeRemoteConflictApply).toHaveBeenCalledWith({
      id: 'settings:theme',
      baseHash: null,
      firstJoin: true
    })
    expect(events).toEqual(['before-remote-conflict-apply', 'insert-settings'])
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: ['theme', '{"mode":"remote-user"}', 'app', '2026-05-29T12:10:00.000Z', null, 2]
      })
    )
    expect(
      mocks.webdav.putFileContents.mock.calls.some(
        ([filePath, contents]) =>
          String(filePath).includes('/storage-v2/records/settings/') && String(contents).includes('local-default')
      )
    ).toBe(false)
    expect(
      mocks.dbClient.execute.mock.calls.some(([input]) => {
        const sql = typeof input === 'string' ? input : input.sql
        return sql.includes('INSERT INTO sync_conflicts')
      })
    ).toBe(false)
  })

  it('auto-resolves exact concurrent Storage v2 edits with a deterministic content tie-breaker', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"alpha"}',
      scope: 'app',
      updated_at: '2026-05-29T12:30:00.000Z',
      deleted_at: null,
      version: 4
    }
    const remoteRow = {
      ...localRow,
      value_json: '{"mode":"omega"}'
    }
    const localHash = hashJson(localRow)
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.updated_at),
      deletedAt: null,
      version: remoteRow.version
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))

    const db = makeSettingsDb([localRow])
    db.state.syncState.set('webdav-storage-record:settings:theme:hash', 'base-hash')
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: remoteRow.version,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      }
    )

    const localShouldWin = localHash >= remoteHash
    const winnerRow = localShouldWin ? localRow : remoteRow
    const winnerHash = localShouldWin ? localHash : remoteHash
    const bundlePath = `/remote-root/sync/v1/${result.manifest.bundle?.path}`
    const bundle = JSON.parse(String(remote.files.get(bundlePath)))

    expect(result.summary.storageConflicts).toBe(0)
    expect(result.summary.storageResolvedConflicts).toBe(1)
    expect(result.manifest.records['settings:theme']?.valueHash).toBe(winnerHash)
    expect(bundle.records['settings:theme'].valueHash).toBe(winnerHash)
    expect(db.state.rows[0]).toMatchObject(winnerRow)
    expect(
      db.client.execute.mock.calls.some(([input]) => {
        const sql = typeof input === 'string' ? input : input.sql
        return sql.includes('INSERT INTO sync_conflicts')
      })
    ).toBe(true)
  })

  it('does not call the remote-conflict safety hook for normal remote-only Storage v2 updates', async () => {
    const remote = makeSharedWebDavStore()
    const localRow = {
      key: 'theme',
      value_json: '{"mode":"light"}',
      scope: 'app',
      updated_at: '2026-05-29T12:00:00.000Z',
      deleted_at: null,
      version: 1
    }
    const remoteRow = {
      ...localRow,
      value_json: '{"mode":"dark"}',
      updated_at: '2026-05-29T12:10:00.000Z',
      version: 2
    }
    const localHash = hashJson(localRow)
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'settings:theme',
      table: settingsTable,
      idValues: ['theme'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.updated_at),
      deletedAt: null,
      version: remoteRow.version
    }
    const beforeRemoteConflictApply = vi.fn()
    remote.files.set('/remote-root/sync/v1/storage-v2/records/settings/theme.json', JSON.stringify(remoteRecord))

    const db = makeSettingsDb([localRow])
    db.state.syncState.set('webdav-storage-record:settings:theme:hash', localHash)
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([settingsTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'settings:theme': {
            entityType: 'settings',
            table: 'settings',
            idValues: ['theme'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: remoteRow.version,
            path: 'storage-v2/records/settings/theme.json'
          }
        }
      },
      {
        beforeRemoteConflictApply
      }
    )

    expect(beforeRemoteConflictApply).not.toHaveBeenCalled()
    expect(result.summary.storageDownloaded).toBe(1)
    expect(result.summary.storageResolvedConflicts).toBe(0)
    expect(db.state.rows[0]).toMatchObject(remoteRow)
  })

  it('simulates two devices syncing through the same WebDAV store', async () => {
    const remote = makeSharedWebDavStore()
    const deviceA = makeSettingsDb([
      {
        key: 'theme',
        value_json: '{"mode":"device-a-user-value"}',
        scope: 'app',
        updated_at: '2026-05-29T12:00:00.000Z',
        deleted_at: null,
        version: 1
      }
    ])
    const deviceB = makeSettingsDb([
      {
        key: 'theme',
        value_json: '{"mode":"device-b-default"}',
        scope: 'app',
        updated_at: '2026-05-29T12:20:00.000Z',
        deleted_at: null,
        version: 3
      }
    ])
    const getClient = vi.mocked(storageV2Database.getClient)
    const service = new StorageV2WebDavRecordSyncService([settingsTable])

    getClient.mockResolvedValueOnce(deviceA.client as any)
    const firstSync = await service.sync(remote.client as any, '/remote-root/sync/v1', null)
    const remoteHashAfterDeviceA = firstSync.manifest.records['settings:theme']?.valueHash

    getClient.mockResolvedValueOnce(deviceB.client as any)
    const secondSync = await service.sync(remote.client as any, '/remote-root/sync/v1', firstSync.manifest)

    expect(firstSync.summary.storageUploaded).toBe(1)
    expect(secondSync.summary.storageDownloaded).toBe(1)
    expect(secondSync.summary.storageUploaded).toBe(0)
    expect(secondSync.summary.storageConflicts).toBe(0)
    expect(deviceB.state.rows[0]).toMatchObject({
      value_json: '{"mode":"device-a-user-value"}',
      updated_at: '2026-05-29T12:00:00.000Z',
      version: 1
    })
    expect(secondSync.manifest.records['settings:theme']?.valueHash).toBe(remoteHashAfterDeviceA)
    expect(
      Array.from(remote.files.entries()).some(
        ([filePath, contents]) =>
          filePath.includes('/storage-v2/records/settings/') && String(contents).includes('device-b-default')
      )
    ).toBe(false)
  })

  it('includes provider credential refs in the default Storage v2 WebDAV bundle', async () => {
    const remote = makeSharedWebDavStore()
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }

    mocks.dbClient.execute.mockImplementation(async (input: string | { sql: string }) => {
      const sql = typeof input === 'string' ? input : input.sql

      if (sql.includes('SELECT * FROM provider_credentials')) {
        return { rows: [credentialRow] }
      }

      if (sql.includes('SELECT value_json FROM sync_state') || sql.includes('INSERT INTO sync_state')) {
        return { rows: [] }
      }

      return { rows: [] }
    })

    const result = await new StorageV2WebDavRecordSyncService().sync(remote.client as any, '/remote-root/sync/v1', null)

    expect(result.summary.storageUploaded).toBe(1)
    expect(result.manifest.records['provider_credential:provider-1:apiKey']).toEqual(
      expect.objectContaining({
        entityType: 'provider_credential',
        table: 'provider_credentials',
        idValues: ['provider-1', 'apiKey'],
        valueHash: hashJson(credentialRow),
        path: expect.stringMatching(HASHED_BUNDLE_PATH)
      })
    )
  })

  it('syncs provider credential refs and encrypted secret values to a second device', async () => {
    const remote = makeSharedWebDavStore()
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({})
    const getClient = vi.mocked(storageV2Database.getClient)
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-provider-1',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    getClient.mockResolvedValueOnce(deviceA.client as any)
    const firstSync = await service.sync(remote.client as any, '/remote-root/sync/v1', null, {
      secretKeyMaterial: 'dav-user:dav-password'
    })

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    getClient.mockResolvedValueOnce(deviceB.client as any)
    const secondSync = await service.sync(remote.client as any, '/remote-root/sync/v1', firstSync.manifest, {
      secretKeyMaterial: 'dav-user:dav-password'
    })

    expect(firstSync.summary.storageUploaded).toBe(1)
    expect(firstSync.summary.secretUploaded).toBe(1)
    expect(secondSync.summary.storageDownloaded).toBe(1)
    expect(secondSync.summary.secretDownloaded).toBe(1)
    expect(deviceB.state.credentials).toEqual([credentialRow])
    expect(mocks.secretVault.importPlaintextSecrets).toHaveBeenCalledWith({
      'provider:provider-1:apiKey': {
        value: 'sk-provider-1',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
  })

  it('uses local provider credential tombstones to avoid resurrecting stale remote key refs', async () => {
    const remote = makeSharedWebDavStore()
    const remoteRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const remoteHash = hashJson(remoteRow)
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/provider_credential/provider-1-apiKey.json',
      JSON.stringify({
        id: 'provider_credential:provider-1:apiKey',
        table: providerCredentialTable,
        idValues: ['provider-1', 'apiKey'],
        row: remoteRow,
        valueHash: remoteHash,
        updatedAt: Date.parse(remoteRow.updated_at),
        deletedAt: null,
        version: 1
      })
    )

    const db = makeProviderCredentialDb({
      tombstones: [
        {
          entity_type: 'provider_credential',
          entity_id: 'provider-1:apiKey',
          deleted_at: '2026-06-01T08:10:00.000Z',
          device_id: 'device-b',
          version: 2
        }
      ]
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([providerCredentialTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'provider_credential:provider-1:apiKey': {
            entityType: 'provider_credential',
            table: 'provider_credentials',
            idValues: ['provider-1', 'apiKey'],
            valueHash: remoteHash,
            updatedAt: Date.parse(remoteRow.updated_at),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/provider_credential/provider-1-apiKey.json'
          }
        }
      }
    )

    expect(result.summary.storageDownloaded).toBe(0)
    expect(db.state.credentials).toEqual([])
    expect(result.manifest.records['provider_credential:provider-1:apiKey']).toBeUndefined()
    expect(
      Object.keys(result.manifest.records).some((id) => id.startsWith('sync_tombstone:provider_credential:'))
    ).toBe(true)
  })

  it('ignores stale local provider credential tombstones when first joining an existing sync space', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({
      tombstones: [
        {
          entity_type: 'provider_credential',
          entity_id: 'provider-1:apiKey',
          deleted_at: '2026-06-01T08:10:00.000Z',
          device_id: 'device-b',
          version: 2
        }
      ]
    })
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable, tombstoneTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-provider-1',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)
    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {}, bundle: null, secrets: null },
      { secretKeyMaterial: 'sync-space-key-material' }
    )

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)
    const secondResult = await service.sync(mocks.webdav as any, '/remote-root/sync/v1', firstResult.manifest, {
      secretKeyMaterial: 'sync-space-key-material',
      preferRemoteOnFirstJoin: true
    })

    expect(secondResult.summary.storageDownloaded).toBe(1)
    expect(secondResult.summary.secretDownloaded).toBe(1)
    expect(deviceB.state.credentials).toEqual([
      expect.objectContaining({
        provider_id: 'provider-1',
        credential_kind: 'apiKey',
        secret_ref: 'storage-v2://secret/provider/provider-1/apiKey'
      })
    ])
    expect(deviceB.state.tombstones).toEqual([])
    expect(secondResult.manifest.records['provider_credential:provider-1:apiKey']).toBeDefined()
    expect(
      Object.keys(secondResult.manifest.records).some((id) => id.startsWith('sync_tombstone:provider_credential:'))
    ).toBe(false)
    expect(mocks.secretVault.importPlaintextSecrets).toHaveBeenCalledWith({
      'provider:provider-1:apiKey': {
        value: 'sk-provider-1',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
  })

  it('uses encoded provider credential tombstones when provider ids contain separators', async () => {
    const remote = makeSharedWebDavStore()
    const remoteRow: ProviderCredentialRow = {
      provider_id: 'provider:custom',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider:custom/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const remoteHash = hashJson(remoteRow)
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/provider_credential/provider-custom-apiKey.json',
      JSON.stringify({
        id: 'provider_credential:provider%3Acustom:apiKey',
        table: providerCredentialTable,
        idValues: ['provider:custom', 'apiKey'],
        row: remoteRow,
        valueHash: remoteHash,
        updatedAt: Date.parse(remoteRow.updated_at),
        deletedAt: null,
        version: 1
      })
    )

    const db = makeProviderCredentialDb({
      tombstones: [
        {
          entity_type: 'provider_credential',
          entity_id: encodeStorageV2CompositeEntityId(['provider:custom', 'apiKey']),
          deleted_at: '2026-06-01T08:10:00.000Z',
          device_id: 'device-b',
          version: 2
        }
      ]
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([providerCredentialTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'provider_credential:provider%3Acustom:apiKey': {
            entityType: 'provider_credential',
            table: 'provider_credentials',
            idValues: ['provider:custom', 'apiKey'],
            valueHash: remoteHash,
            updatedAt: Date.parse(remoteRow.updated_at),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/provider_credential/provider-custom-apiKey.json'
          }
        }
      }
    )

    expect(result.summary.storageDownloaded).toBe(0)
    expect(db.state.credentials).toEqual([])
    expect(result.manifest.records['provider_credential:provider%3Acustom:apiKey']).toBeUndefined()
  })

  it('maps remote builtin skill IDs to an existing local folder_name before applying agent skill rows', async () => {
    const remote = makeSharedWebDavStore()
    const localSkill: SkillRow = {
      id: 'local-settings-skill',
      name: 'Settings',
      description: null,
      folder_name: 'settings',
      source: 'builtin',
      source_url: null,
      namespace: null,
      author: null,
      tags_json: null,
      content_hash: 'local-hash',
      created_at: '2026-05-29T12:00:00.000Z',
      updated_at: '2026-05-29T12:00:00.000Z',
      deleted_at: null,
      version: 1
    }
    const remoteSkill: SkillRow = {
      ...localSkill,
      id: 'remote-settings-skill',
      name: 'Settings Remote',
      content_hash: 'remote-hash',
      updated_at: '2026-05-29T12:10:00.000Z',
      version: 2
    }
    const remoteAgentSkill: AgentSkillRow = {
      agent_id: 'agent-1',
      skill_id: 'remote-settings-skill',
      enabled: 1,
      created_at: '2026-05-29T12:10:00.000Z',
      updated_at: '2026-05-29T12:10:00.000Z'
    }
    const remoteSkillHash = hashJson(remoteSkill)
    const remoteAgentSkillHash = hashJson(remoteAgentSkill)

    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/skill/settings.json',
      JSON.stringify({
        id: 'skill:remote-settings-skill',
        table: skillTable,
        idValues: ['remote-settings-skill'],
        row: remoteSkill,
        valueHash: remoteSkillHash,
        updatedAt: Date.parse(remoteSkill.updated_at),
        deletedAt: null,
        version: 2
      })
    )
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/agent_skill/settings.json',
      JSON.stringify({
        id: 'agent_skill:agent-1:remote-settings-skill',
        table: agentSkillTable,
        idValues: ['agent-1', 'remote-settings-skill'],
        row: remoteAgentSkill,
        valueHash: remoteAgentSkillHash,
        updatedAt: Date.parse(remoteAgentSkill.updated_at),
        deletedAt: null,
        version: 1
      })
    )

    const db = makeSkillAliasDb({ skills: [localSkill] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([skillTable, agentSkillTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'skill:remote-settings-skill': {
            entityType: 'skill',
            table: 'skills',
            idValues: ['remote-settings-skill'],
            valueHash: remoteSkillHash,
            updatedAt: Date.parse(remoteSkill.updated_at),
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/skill/settings.json'
          },
          'agent_skill:agent-1:remote-settings-skill': {
            entityType: 'agent_skill',
            table: 'agent_skills',
            idValues: ['agent-1', 'remote-settings-skill'],
            valueHash: remoteAgentSkillHash,
            updatedAt: Date.parse(remoteAgentSkill.updated_at),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/agent_skill/settings.json'
          }
        }
      }
    )

    expect(result.summary.storageDownloaded).toBe(2)
    expect(db.state.skills).toHaveLength(1)
    expect(db.state.skills[0]).toMatchObject({
      id: 'local-settings-skill',
      folder_name: 'settings',
      name: 'Settings Remote',
      content_hash: 'remote-hash'
    })
    expect(db.state.agentSkills).toEqual([
      {
        ...remoteAgentSkill,
        skill_id: 'local-settings-skill'
      }
    ])
  })

  it('uses local tombstones to avoid resurrecting stale association rows', async () => {
    const remote = makeSharedWebDavStore()
    const remoteRow: AgentSkillRow = {
      agent_id: 'agent-1',
      skill_id: 'skill-1',
      enabled: 1,
      created_at: '2026-05-29T12:00:00.000Z',
      updated_at: '2026-05-29T12:00:00.000Z'
    }
    const remoteHash = hashJson(remoteRow)
    const remoteRecord = {
      id: 'agent_skill:agent-1:skill-1',
      table: agentSkillTable,
      idValues: ['agent-1', 'skill-1'],
      row: remoteRow,
      valueHash: remoteHash,
      updatedAt: Date.parse(remoteRow.updated_at),
      deletedAt: null,
      version: 1
    }
    remote.files.set('/remote-root/sync/v1/storage-v2/records/agent_skill/stale.json', JSON.stringify(remoteRecord))

    const db = makeAgentSkillDb({
      tombstones: [
        {
          entity_type: 'agent_skill',
          entity_id: 'agent-1:skill-1',
          deleted_at: '2026-05-29T12:10:00.000Z',
          device_id: 'device-b',
          version: 2
        }
      ]
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([agentSkillTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'agent_skill:agent-1:skill-1': {
            entityType: 'agent_skill',
            table: 'agent_skills',
            idValues: ['agent-1', 'skill-1'],
            valueHash: remoteHash,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/agent_skill/stale.json'
          }
        }
      }
    )

    expect(result.summary.storageDownloaded).toBe(0)
    expect(db.state.agentSkills).toEqual([])
    expect(result.manifest.records['agent_skill:agent-1:skill-1']).toBeUndefined()
    expect(Object.keys(result.manifest.records).some((id) => id.startsWith('sync_tombstone:agent_skill:'))).toBe(true)
  })

  it('does not upload stale local association rows covered by newer remote tombstones', async () => {
    const remote = makeSharedWebDavStore()
    const associationRow: AgentSkillRow = {
      agent_id: 'agent-1',
      skill_id: 'skill-1',
      enabled: 1,
      created_at: '2026-05-29T12:00:00.000Z',
      updated_at: '2026-05-29T12:00:00.000Z'
    }
    const tombstoneEntityId = encodeStorageV2CompositeEntityId(['agent-1', 'skill-1'])
    const tombstoneRow: TombstoneRow = {
      entity_type: 'agent_skill',
      entity_id: tombstoneEntityId,
      deleted_at: '2026-05-29T12:10:00.000Z',
      device_id: 'device-b',
      version: 2
    }
    const tombstoneHash = hashJson(tombstoneRow)
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/sync_tombstone/delete.json',
      JSON.stringify({
        id: 'sync_tombstone:agent_skill:%5B%22agent-1%22%2C%22skill-1%22%5D',
        table: tombstoneTable,
        idValues: ['agent_skill', tombstoneEntityId],
        row: tombstoneRow,
        valueHash: tombstoneHash,
        updatedAt: Date.parse(tombstoneRow.deleted_at),
        deletedAt: null,
        version: 2
      })
    )

    const db = makeAgentSkillDb({ agentSkills: [associationRow] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([agentSkillTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'sync_tombstone:agent_skill:%5B%22agent-1%22%2C%22skill-1%22%5D': {
            entityType: 'sync_tombstone',
            table: 'sync_tombstones',
            idValues: ['agent_skill', tombstoneEntityId],
            valueHash: tombstoneHash,
            updatedAt: Date.parse(tombstoneRow.deleted_at),
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/sync_tombstone/delete.json'
          }
        }
      }
    )

    expect(result.summary.storageUploaded).toBe(0)
    expect(result.summary.storageDownloaded).toBe(1)
    expect(db.state.agentSkills).toEqual([])
    expect(db.state.tombstones).toEqual([tombstoneRow])
    expect(result.manifest.records['agent_skill:agent-1:skill-1']).toBeUndefined()
  })

  it('keeps local association rows that are newer than stale remote tombstones', async () => {
    const remote = makeSharedWebDavStore()
    const associationRow: AgentSkillRow = {
      agent_id: 'agent-1',
      skill_id: 'skill-1',
      enabled: 1,
      created_at: '2026-05-29T12:10:00.000Z',
      updated_at: '2026-05-29T12:10:00.000Z'
    }
    const tombstoneEntityId = encodeStorageV2CompositeEntityId(['agent-1', 'skill-1'])
    const tombstoneRow: TombstoneRow = {
      entity_type: 'agent_skill',
      entity_id: tombstoneEntityId,
      deleted_at: '2026-05-29T12:00:00.000Z',
      device_id: 'device-b',
      version: 2
    }
    const tombstoneHash = hashJson(tombstoneRow)
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/sync_tombstone/stale-delete.json',
      JSON.stringify({
        id: 'sync_tombstone:agent_skill:%5B%22agent-1%22%2C%22skill-1%22%5D',
        table: tombstoneTable,
        idValues: ['agent_skill', tombstoneEntityId],
        row: tombstoneRow,
        valueHash: tombstoneHash,
        updatedAt: Date.parse(tombstoneRow.deleted_at),
        deletedAt: null,
        version: 2
      })
    )

    const db = makeAgentSkillDb({ agentSkills: [associationRow] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([agentSkillTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'sync_tombstone:agent_skill:%5B%22agent-1%22%2C%22skill-1%22%5D': {
            entityType: 'sync_tombstone',
            table: 'sync_tombstones',
            idValues: ['agent_skill', tombstoneEntityId],
            valueHash: tombstoneHash,
            updatedAt: Date.parse(tombstoneRow.deleted_at),
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/sync_tombstone/stale-delete.json'
          }
        }
      }
    )

    expect(result.summary.storageUploaded).toBe(1)
    expect(db.state.agentSkills).toEqual([associationRow])
    expect(db.state.tombstones).toEqual([])
    expect(result.manifest.records['agent_skill:agent-1:skill-1']).toBeDefined()
    expect(Object.keys(result.manifest.records).some((id) => id.startsWith('sync_tombstone:agent_skill:'))).toBe(false)
  })

  it('applies remote tombstones to physically deleted association rows', async () => {
    const remote = makeSharedWebDavStore()
    const associationRow: AgentSkillRow = {
      agent_id: 'agent-1',
      skill_id: 'skill-1',
      enabled: 1,
      created_at: '2026-05-29T12:00:00.000Z',
      updated_at: '2026-05-29T12:00:00.000Z'
    }
    const tombstoneRow: TombstoneRow = {
      entity_type: 'agent_skill',
      entity_id: 'agent-1:skill-1',
      deleted_at: '2026-05-29T12:10:00.000Z',
      device_id: 'device-b',
      version: 2
    }
    const associationHash = hashJson(associationRow)
    const tombstoneHash = hashJson(tombstoneRow)
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/agent_skill/stale.json',
      JSON.stringify({
        id: 'agent_skill:agent-1:skill-1',
        table: agentSkillTable,
        idValues: ['agent-1', 'skill-1'],
        row: associationRow,
        valueHash: associationHash,
        updatedAt: Date.parse(associationRow.updated_at),
        deletedAt: null,
        version: 1
      })
    )
    remote.files.set(
      '/remote-root/sync/v1/storage-v2/records/sync_tombstone/delete.json',
      JSON.stringify({
        id: 'sync_tombstone:agent_skill:agent-1%3Askill-1',
        table: tombstoneTable,
        idValues: ['agent_skill', 'agent-1:skill-1'],
        row: tombstoneRow,
        valueHash: tombstoneHash,
        updatedAt: Date.parse(tombstoneRow.deleted_at),
        deletedAt: null,
        version: 2
      })
    )

    const db = makeAgentSkillDb({ agentSkills: [associationRow] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    const result = await new StorageV2WebDavRecordSyncService([agentSkillTable, tombstoneTable]).sync(
      remote.client as any,
      '/remote-root/sync/v1',
      {
        version: 1,
        blobs: {},
        records: {
          'agent_skill:agent-1:skill-1': {
            entityType: 'agent_skill',
            table: 'agent_skills',
            idValues: ['agent-1', 'skill-1'],
            valueHash: associationHash,
            updatedAt: Date.parse(associationRow.updated_at),
            deletedAt: null,
            version: 1,
            path: 'storage-v2/records/agent_skill/stale.json'
          },
          'sync_tombstone:agent_skill:agent-1%3Askill-1': {
            entityType: 'sync_tombstone',
            table: 'sync_tombstones',
            idValues: ['agent_skill', 'agent-1:skill-1'],
            valueHash: tombstoneHash,
            updatedAt: Date.parse(tombstoneRow.deleted_at),
            deletedAt: null,
            version: 2,
            path: 'storage-v2/records/sync_tombstone/delete.json'
          }
        }
      }
    )

    expect(db.state.agentSkills).toEqual([])
    expect(db.state.tombstones).toEqual([tombstoneRow])
    expect(result.manifest.records['agent_skill:agent-1:skill-1']).toBeUndefined()
  })

  it('syncs Storage v2 secret vault entries through encrypted WebDAV bundles', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({})
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      },
      'provider:stale:apiKey': {
        value: 'sk-stale-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)

    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )

    expect(firstResult.summary.secretUploaded).toBe(1)
    expect(firstResult.manifest.secrets).toMatchObject({
      version: 1,
      secretCount: 1,
      encryption: 'cherry-webdav-secret-sync-aes-256-gcm'
    })
    const remoteSecretPath = `/remote-root/sync/v1/${firstResult.manifest.secrets?.path}`
    const remoteSecretBundle = JSON.parse(String(mocks.remoteFiles.get(remoteSecretPath)))
    expect(JSON.stringify(remoteSecretBundle)).not.toContain('sk-local-provider')
    expect(JSON.stringify(remoteSecretBundle)).not.toContain('sk-stale-provider')
    expect(Object.keys(remoteSecretBundle.secrets)).toEqual(['provider:provider-1:apiKey'])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)

    const secondResult = await service.sync(mocks.webdav as any, '/remote-root/sync/v1', firstResult.manifest, {
      secretKeyMaterial: 'dav-user:dav-password'
    })

    expect(secondResult.summary.secretDownloaded).toBe(1)
    expect(mocks.secretVault.importPlaintextSecrets).toHaveBeenCalledWith({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
  })

  it('drops remote secret vault metadata when no current Storage v2 records reference secrets', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({
      tombstones: [
        {
          entity_type: 'provider_credential',
          entity_id: 'provider-1:apiKey',
          deleted_at: '2026-06-01T08:10:00.000Z',
          device_id: 'device-b',
          version: 2
        }
      ]
    })
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable, tombstoneTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)
    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)
    const secondResult = await service.sync(mocks.webdav as any, '/remote-root/sync/v1', firstResult.manifest, {
      secretKeyMaterial: 'dav-user:wrong-password'
    })

    expect(secondResult.manifest.records['provider_credential:provider-1:apiKey']).toBeUndefined()
    expect(secondResult.manifest.secrets).toBeNull()
    expect(secondResult.summary.secretDownloaded).toBe(0)
    expect(mocks.secretVault.importPlaintextSecrets).not.toHaveBeenCalled()
  })

  it('republishes a secret vault manifest when the semantic secret bundle path already exists', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({ credentials: [credentialRow] })
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])
    const localSecrets = {
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    }

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce(localSecrets)
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)
    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )
    const firstSecretPath = firstResult.manifest.secrets?.path
    expect(firstSecretPath).toEqual(expect.stringMatching(HASHED_SECRET_PATH))
    const remoteSecretPath = `/remote-root/sync/v1/${firstSecretPath}`
    const firstCiphertext = String(mocks.remoteFiles.get(remoteSecretPath))

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce(localSecrets)
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)
    const secondResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {}, bundle: null, secrets: null },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )

    expect(secondResult.summary.secretUploaded).toBe(1)
    expect(secondResult.manifest.secrets?.path).toBe(firstSecretPath)
    expect(mocks.remoteFiles.get(remoteSecretPath)).toBeTruthy()
    expect(String(mocks.remoteFiles.get(remoteSecretPath))).not.toBe(firstCiphertext)
  })

  it('fails safely when the remote secret vault cannot be decrypted with the current sync space key', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({})
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)

    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)

    await expect(
      service.sync(mocks.webdav as any, '/remote-root/sync/v1', firstResult.manifest, {
        secretKeyMaterial: 'dav-user:wrong-password'
      })
    ).rejects.toThrow('远端敏感配置无法解密')
    expect(deviceB.state.credentials).toEqual([])
    expect(mocks.secretVault.importPlaintextSecrets).not.toHaveBeenCalled()
  })

  it('can migrate an old WebDAV-password encrypted secret vault to the sync space key', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({})
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)
    const oldEncryptedResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'old-webdav-password-material' }
    )

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)
    const migratedResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      oldEncryptedResult.manifest,
      {
        secretKeyMaterial: 'sync-space-key-material',
        legacySecretKeyMaterial: 'old-webdav-password-material'
      }
    )

    expect(migratedResult.summary.secretDownloaded).toBe(1)
    expect(migratedResult.manifest.secrets?.valueHash).toBe(oldEncryptedResult.manifest.secrets?.valueHash)
    expect(mocks.secretVault.importPlaintextSecrets).toHaveBeenCalledWith({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(makeProviderCredentialDb({}).client as any)
    await expect(
      service.sync(mocks.webdav as any, '/remote-root/sync/v1', migratedResult.manifest, {
        secretKeyMaterial: 'sync-space-key-material'
      })
    ).resolves.toEqual(expect.objectContaining({ summary: expect.objectContaining({ secretDownloaded: 1 }) }))
  })

  it('does not publish local records that reference missing secret vault entries', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const db = makeProviderCredentialDb({ credentials: [credentialRow] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)
    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({})

    await expect(
      new StorageV2WebDavRecordSyncService([providerCredentialTable]).sync(
        mocks.webdav as any,
        '/remote-root/sync/v1',
        { version: 1, blobs: {}, records: {}, bundle: null, secrets: null },
        { secretKeyMaterial: 'dav-user:dav-password' }
      )
    ).rejects.toThrow('本机和远端都不存在的敏感配置')

    expect(Array.from(mocks.remoteFiles.keys()).some((filePath) => filePath.includes('/storage-v2/bundle/'))).toBe(
      false
    )
    expect(mocks.secretVault.importPlaintextSecrets).not.toHaveBeenCalled()
  })

  it('does not publish local records that contain invalid secret refs', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/%',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const db = makeProviderCredentialDb({ credentials: [credentialRow] })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(db.client as any)

    await expect(
      new StorageV2WebDavRecordSyncService([providerCredentialTable]).sync(
        mocks.webdav as any,
        '/remote-root/sync/v1',
        { version: 1, blobs: {}, records: {}, bundle: null, secrets: null },
        { secretKeyMaterial: 'dav-user:dav-password' }
      )
    ).rejects.toThrow('无法识别的敏感配置引用')

    expect(Array.from(mocks.remoteFiles.keys()).some((filePath) => filePath.includes('/storage-v2/bundle/'))).toBe(
      false
    )
    expect(mocks.secretVault.exportPlaintextSecrets).not.toHaveBeenCalled()
  })

  it('does not write remote records that reference missing secret bundles', async () => {
    const credentialRow: ProviderCredentialRow = {
      provider_id: 'provider-1',
      credential_kind: 'apiKey',
      secret_ref: 'storage-v2://secret/provider/provider-1/apiKey',
      updated_at: '2026-06-01T08:00:00.000Z',
      updated_by_device_id: 'device-a'
    }
    const deviceA = makeProviderCredentialDb({ credentials: [credentialRow] })
    const deviceB = makeProviderCredentialDb({})
    const service = new StorageV2WebDavRecordSyncService([providerCredentialTable])

    mocks.secretVault.exportPlaintextSecrets.mockResolvedValueOnce({
      'provider:provider-1:apiKey': {
        value: 'sk-local-provider',
        updatedAt: '2026-06-01T08:00:00.000Z'
      }
    })
    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceA.client as any)
    const firstResult = await service.sync(
      mocks.webdav as any,
      '/remote-root/sync/v1',
      { version: 1, blobs: {}, records: {} },
      { secretKeyMaterial: 'dav-user:dav-password' }
    )

    vi.mocked(storageV2Database.getClient).mockResolvedValueOnce(deviceB.client as any)
    await expect(
      service.sync(
        mocks.webdav as any,
        '/remote-root/sync/v1',
        { ...firstResult.manifest, secrets: null },
        { secretKeyMaterial: 'dav-user:dav-password' }
      )
    ).rejects.toThrow('缺少敏感配置数据包')

    expect(deviceB.state.credentials).toEqual([])
    expect(mocks.secretVault.importPlaintextSecrets).not.toHaveBeenCalled()
  })
})
