import { storageV2AgentDbMirrorService } from './AgentDbMirrorService'
import {
  type StorageV2LegacyAgentDbImportReport,
  storageV2LegacyAgentDbImportService
} from './LegacyAgentDbImportService'
import { type StorageV2LegacyAppDbImportReport, storageV2LegacyAppDbImportService } from './LegacyAppDbImportService'

export type StorageV2StartupSeedOptions = {
  createSnapshot?: boolean
}

export type StorageV2StartupSeedReport = {
  generatedAt: string
  agent: StorageV2LegacyAgentDbImportReport
  appData: StorageV2LegacyAppDbImportReport
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeMessageText(message: unknown) {
  if (typeof message !== 'string') return null

  const normalizedMessage = message.trim()
  return normalizedMessage.length > 0 ? normalizedMessage : null
}

function parseStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value)
  return null
}

function extractErrorMessage(error: unknown, seen = new WeakSet<object>()): string | null {
  if (error instanceof Error) {
    return normalizeMessageText(error.message) ?? extractErrorMessage(error.cause, seen)
  }

  if (typeof error === 'string') return normalizeMessageText(error)
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)

  const source = asObject(error)
  if (!source) return null

  if (seen.has(source)) return null
  seen.add(source)

  for (const key of ['message', 'error', 'cause', 'reason', 'description', 'response'] as const) {
    const message = extractErrorMessage(source[key], seen)
    if (message) return message
  }

  const status = parseStatus(source.status) ?? parseStatus(source.statusCode) ?? parseStatus(source.code)
  const statusText = normalizeMessageText(source.statusText)
  if (status && statusText) return `${status} ${statusText}`
  if (status) return `HTTP ${status}`

  const code = normalizeMessageText(source.code)
  return code
}

function errorMessage(error: unknown) {
  return extractErrorMessage(error) ?? 'Unknown Storage v2 startup seed error'
}

function failedAgentReport(error: unknown): StorageV2LegacyAgentDbImportReport {
  return {
    dryRun: false,
    sourceDbPath: null,
    agentCount: 0,
    sessionCount: 0,
    sessionMessageCount: 0,
    skillCount: 0,
    agentSkillCount: 0,
    taskCount: 0,
    taskRunLogCount: 0,
    channelCount: 0,
    channelTaskSubscriptionCount: 0,
    importedAgentCount: 0,
    importedSessionCount: 0,
    importedSessionMessageCount: 0,
    importedSkillCount: 0,
    importedAgentSkillCount: 0,
    importedTaskCount: 0,
    importedTaskRunLogCount: 0,
    importedChannelCount: 0,
    importedChannelTaskSubscriptionCount: 0,
    secretCandidateCount: 0,
    importedSecretCount: 0,
    skippedSecretCount: 0,
    warnings: [`Legacy agents.db startup seed failed: ${errorMessage(error)}`]
  }
}

function failedAppDataReport(error: unknown): StorageV2LegacyAppDbImportReport {
  return {
    dryRun: false,
    sourceDbPath: null,
    recordCount: 0,
    cacheCount: 0,
    syncStateCount: 0,
    syncConflictCount: 0,
    workbenchShortcutCount: 0,
    importedRecordCount: 0,
    importedCacheCount: 0,
    importedSyncStateCount: 0,
    importedSyncConflictCount: 0,
    importedWorkbenchShortcutCount: 0,
    secretCandidateCount: 0,
    importedSecretCount: 0,
    skippedSecretCount: 0,
    warnings: [`Legacy app.db startup seed failed: ${errorMessage(error)}`]
  }
}

export class StorageV2StartupSeedService {
  private inFlight: Promise<StorageV2StartupSeedReport> | null = null

  seedFromLegacyRuntimeDatabases(options: StorageV2StartupSeedOptions = {}): Promise<StorageV2StartupSeedReport> {
    if (!this.inFlight) {
      this.inFlight = this.run(options).finally(() => {
        this.inFlight = null
      })
    }

    return this.inFlight
  }

  private async run(options: StorageV2StartupSeedOptions): Promise<StorageV2StartupSeedReport> {
    const createSnapshot = options.createSnapshot === true

    await storageV2AgentDbMirrorService.flush()
    const agent = await storageV2LegacyAgentDbImportService
      .importSnapshot({
        dryRun: false,
        createSnapshot,
        pruneMissing: false
      })
      .catch(failedAgentReport)
    const appData = await storageV2LegacyAppDbImportService
      .importSnapshot({
        dryRun: false,
        createSnapshot,
        pruneMissing: false
      })
      .catch(failedAppDataReport)

    return {
      generatedAt: new Date().toISOString(),
      agent,
      appData
    }
  }
}

export const storageV2StartupSeedService = new StorageV2StartupSeedService()
