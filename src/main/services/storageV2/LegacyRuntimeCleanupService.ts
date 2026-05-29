import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { getConfigDir } from '../../utils/file'
import { storageV2DataRootService } from './DataRootService'
import { getAvailablePathSync, movePathSync } from './SafeFileMove'
import { storageV2Database } from './StorageV2Database'
import { storageV2SettingsRepository } from './StorageV2Repositories'

export type StorageV2LegacyRuntimePolicy = {
  id: string
  label: string
  role: 'runtime-cache' | 'runtime-projection' | 'legacy-source' | 'sensitive-legacy-projection'
  retention: 'keep' | 'archive-after-storage-v2-backed' | 'manual-review'
  notes: string
}

export type StorageV2SensitiveLegacyProjectionAction = 'archive' | 'keep' | 'missing'

export type StorageV2SensitiveLegacyProjectionState = 'backed' | 'cleared' | 'missing'

export type StorageV2SensitiveLegacyProjectionPlanItem = {
  id: string
  label: string
  path: string
  exists: boolean
  storageV2State: StorageV2SensitiveLegacyProjectionState
  action: StorageV2SensitiveLegacyProjectionAction
  reason: string
  archivedPath?: string
}

export type StorageV2SensitiveLegacyProjectionCleanupReport = {
  dryRun: boolean
  generatedAt: string
  snapshotPath: string | null
  archiveRoot: string | null
  archivedCount: number
  items: StorageV2SensitiveLegacyProjectionPlanItem[]
}

type SensitiveLegacyProjectionDefinition = {
  id: string
  label: string
  settingKey: string
  secretRefField: string
  getPath: () => string
}

export const STORAGE_V2_LEGACY_RUNTIME_POLICIES: readonly StorageV2LegacyRuntimePolicy[] = [
  {
    id: 'redux-local-storage',
    label: 'Redux / Chromium Local Storage',
    role: 'runtime-cache',
    retention: 'keep',
    notes: 'Renderer UI cache remains readable and hydrateable; Storage v2 is authoritative for durable settings.'
  },
  {
    id: 'indexeddb-dexie',
    label: 'Dexie / IndexedDB',
    role: 'runtime-cache',
    retention: 'keep',
    notes: 'Conversation/file/settings tables stay as runtime cache until the renderer fully reads Storage v2 directly.'
  },
  {
    id: 'data-agents-db',
    label: 'Data/agents.db',
    role: 'runtime-cache',
    retention: 'keep',
    notes: 'Pi agent runtime database is rebuilt from Storage v2 after restore and remains a compatibility cache.'
  },
  {
    id: 'data-app-db',
    label: 'Data/app.db',
    role: 'runtime-cache',
    retention: 'keep',
    notes: 'App scoped records, WebDAV state, and workbench shortcuts are projected back for current runtime callers.'
  },
  {
    id: 'openclaw-config',
    label: 'OpenClaw runtime config',
    role: 'runtime-projection',
    retention: 'keep',
    notes: 'External gateway requires openclaw.json; Storage v2 secret vault is the backup/restore authority.'
  },
  {
    id: 'ovms-config',
    label: 'OVMS model config',
    role: 'runtime-projection',
    retention: 'keep',
    notes: 'OVMS requires models/config.json; Storage v2 ovms.model_config is the recoverable authority.'
  },
  {
    id: 'mcp-memory-json',
    label: 'MCP memory.json',
    role: 'runtime-projection',
    retention: 'keep',
    notes: 'The memory MCP server still writes the JSON projection after Storage v2 secret-backed persistence.'
  },
  {
    id: 'anthropic-oauth-legacy',
    label: 'Anthropic OAuth legacy JSON',
    role: 'sensitive-legacy-projection',
    retention: 'archive-after-storage-v2-backed',
    notes: 'Plain OAuth credentials can be archived once the Storage v2 secret ref or explicit clear marker exists.'
  },
  {
    id: 'copilot-token-legacy',
    label: 'Copilot legacy token files',
    role: 'sensitive-legacy-projection',
    retention: 'archive-after-storage-v2-backed',
    notes: 'Legacy token files are compatibility fallbacks and can be archived after Storage v2 is backed.'
  },
  {
    id: 'legacy-user-data-agents-db',
    label: 'Old userData agents.db',
    role: 'legacy-source',
    retention: 'manual-review',
    notes: 'Old top-level database should stay visible in audit until a user-controlled archive/delete flow exists.'
  },
  {
    id: 'legacy-user-data-memory-db',
    label: 'Old userData memories.db',
    role: 'legacy-source',
    retention: 'manual-review',
    notes:
      'Old top-level memory database should stay visible in audit until a user-controlled archive/delete flow exists.'
  }
]

const SENSITIVE_LEGACY_PROJECTIONS: readonly SensitiveLegacyProjectionDefinition[] = [
  {
    id: 'anthropic-oauth-legacy',
    label: 'Anthropic OAuth legacy JSON',
    settingKey: 'anthropic.oauth.credentials',
    secretRefField: 'credentialsSecretRef',
    getPath: () => path.join(getConfigDir(), 'oauth', 'anthropic.json')
  },
  {
    id: 'copilot-token-user-data',
    label: 'Copilot legacy token in userData',
    settingKey: 'copilot.accessToken',
    secretRefField: 'accessTokenSecretRef',
    getPath: () => path.join(app.getPath('userData'), '.copilot_token')
  },
  {
    id: 'copilot-token-config',
    label: 'Copilot legacy token in config',
    settingKey: 'copilot.accessToken',
    secretRefField: 'accessTokenSecretRef',
    getPath: () => path.join(getConfigDir(), '.copilot_token')
  }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getStorageV2ProjectionState(value: unknown, secretRefField: string): StorageV2SensitiveLegacyProjectionState {
  if (!isRecord(value)) return 'missing'
  if (typeof value.clearedAt === 'string' && value.clearedAt) return 'cleared'

  const secretRef = value[secretRefField]
  return typeof secretRef === 'string' && secretRef ? 'backed' : 'missing'
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function getArchivePath(archiveRoot: string, item: StorageV2SensitiveLegacyProjectionPlanItem) {
  return getAvailablePathSync(path.join(archiveRoot, item.id, path.basename(item.path)))
}

export function listStorageV2LegacyRuntimePolicies(): readonly StorageV2LegacyRuntimePolicy[] {
  return STORAGE_V2_LEGACY_RUNTIME_POLICIES
}

export class StorageV2LegacyRuntimeCleanupService {
  async getSensitiveLegacyProjectionPlan(): Promise<StorageV2SensitiveLegacyProjectionCleanupReport> {
    const items: StorageV2SensitiveLegacyProjectionPlanItem[] = []

    for (const definition of SENSITIVE_LEGACY_PROJECTIONS) {
      const projectionPath = definition.getPath()
      const exists = fs.existsSync(projectionPath)
      const setting = await storageV2SettingsRepository.get(definition.settingKey)
      const storageV2State = getStorageV2ProjectionState(setting, definition.secretRefField)
      const shouldArchive = exists && (storageV2State === 'backed' || storageV2State === 'cleared')

      items.push({
        id: definition.id,
        label: definition.label,
        path: projectionPath,
        exists,
        storageV2State,
        action: shouldArchive ? 'archive' : exists ? 'keep' : 'missing',
        reason: shouldArchive
          ? 'Storage v2 has a secret ref or clear marker, so the legacy sensitive projection can be archived.'
          : exists
            ? 'Legacy projection still exists but Storage v2 is not backed yet; keep it as fallback.'
            : 'Legacy projection is not present.'
      })
    }

    return {
      dryRun: true,
      generatedAt: new Date().toISOString(),
      snapshotPath: null,
      archiveRoot: null,
      archivedCount: 0,
      items
    }
  }

  async cleanupSensitiveLegacyProjections(
    options: { dryRun?: boolean } = {}
  ): Promise<StorageV2SensitiveLegacyProjectionCleanupReport> {
    const dryRun = options.dryRun !== false
    const report = await this.getSensitiveLegacyProjectionPlan()
    const archiveItems = report.items.filter((item) => item.action === 'archive')

    report.dryRun = dryRun

    if (dryRun || archiveItems.length === 0) {
      return report
    }

    const snapshot = await storageV2Database.createSnapshot('before-sensitive-legacy-cleanup')
    const dataRoot = storageV2DataRootService.ensureDataRoot().dataRoot
    const archiveRoot = path.join(dataRoot, 'legacy', `sensitive-projections-${timestampForFilename()}`)

    for (const item of archiveItems) {
      if (!fs.existsSync(item.path)) continue
      const archivedPath = getArchivePath(archiveRoot, item)
      movePathSync(item.path, archivedPath)
      item.archivedPath = archivedPath
    }

    report.snapshotPath = snapshot.path
    report.archiveRoot = archiveRoot
    report.archivedCount = report.items.filter((item) => item.archivedPath).length
    return report
  }
}

export const storageV2LegacyRuntimeCleanupService = new StorageV2LegacyRuntimeCleanupService()
