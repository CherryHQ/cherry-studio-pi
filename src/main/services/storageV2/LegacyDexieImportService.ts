import {
  type StorageV2ConversationImport,
  storageV2ConversationRepository,
  type StorageV2FileImport,
  storageV2FileRepository,
  storageV2SettingsRepository
} from './StorageV2Repositories'

type LegacyDexieTopic = Record<string, any> & {
  id?: string
  assistantId?: string
  name?: string
  title?: string
  createdAt?: string
  updatedAt?: string
  pinned?: boolean
}

type LegacyDexieConversationInput = {
  assistantId?: string
  topic?: LegacyDexieTopic
  messages?: Array<Record<string, any>>
  blocks?: Array<Record<string, any>>
}

const DEXIE_AUXILIARY_TABLE_NAMES = [
  'knowledge_notes',
  'quick_phrases',
  'translate_history',
  'translate_languages'
] as const

type DexieAuxiliaryTableName = (typeof DEXIE_AUXILIARY_TABLE_NAMES)[number]

type DexieAuxiliaryRow = Record<string, unknown> & {
  id?: string
}

type LegacyDexieSnapshot = {
  conversations?: LegacyDexieConversationInput[]
  files?: StorageV2FileImport[]
  settings?: Array<{ id?: string; value?: unknown }>
  dexieTables?: Partial<Record<DexieAuxiliaryTableName, DexieAuxiliaryRow[]>>
}

export type StorageV2LegacyDexieImportOptions = {
  dryRun?: boolean
  pruneMissing?: boolean
}

export type StorageV2LegacyDexieImportReport = {
  dryRun: boolean
  conversationCount: number
  messageCount: number
  blockCount: number
  fileCount: number
  settingCount: number
  dexieTableRowCount: number
  importedConversationCount: number
  importedMessageCount: number
  importedBlockCount: number
  importedFileCount: number
  importedSettingCount: number
  importedDexieTableRowCount: number
  skippedFileCount: number
  deletedConversationCount: number
  deletedFileCount: number
  warnings: string[]
}

function parseMaybeJson<T>(value: T | string | undefined): T | undefined {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function normalizeSnapshot(input: LegacyDexieSnapshot | string): LegacyDexieSnapshot {
  return parseMaybeJson<LegacyDexieSnapshot>(input) ?? {}
}

function normalizeConversation(
  input: LegacyDexieConversationInput,
  index: number,
  warnings: string[]
): StorageV2ConversationImport | null {
  const topic = input.topic
  const topicId = typeof topic?.id === 'string' ? topic.id : undefined
  const ownerId = input.assistantId ?? topic?.assistantId

  if (!topicId) {
    warnings.push(`Skipped legacy Dexie conversation at index ${index}: missing topic id.`)
    return null
  }

  if (!ownerId) {
    warnings.push(`Skipped legacy Dexie conversation ${topicId}: missing assistant id.`)
    return null
  }

  const topicRecord = topic!
  const messages = Array.isArray(input.messages) ? input.messages : []
  const blocks = Array.isArray(input.blocks) ? input.blocks : []

  return {
    id: topicId,
    kind: 'assistant_chat',
    ownerType: 'assistant',
    ownerId,
    title: topicRecord.name ?? topicRecord.title ?? undefined,
    pinned: Boolean(topicRecord.pinned),
    archived: false,
    sortOrder: index,
    createdAt: topicRecord.createdAt,
    updatedAt: topicRecord.updatedAt ?? topicRecord.createdAt,
    messages,
    blocks
  }
}

function toStorageV2DexieTableKey(tableName: DexieAuxiliaryTableName, rowId: string) {
  return `dexie.table.${tableName}.${rowId}`
}

function normalizeDexieTableRows(snapshot: LegacyDexieSnapshot, warnings: string[]) {
  const rows: Array<{ tableName: DexieAuxiliaryTableName; row: Record<string, unknown> & { id: string } }> = []
  const tables = snapshot.dexieTables ?? {}

  for (const tableName of DEXIE_AUXILIARY_TABLE_NAMES) {
    const tableRows = Array.isArray(tables[tableName]) ? tables[tableName] : []
    for (const [index, row] of tableRows.entries()) {
      if (typeof row?.id !== 'string' || row.id.length === 0) {
        warnings.push(`Skipped legacy Dexie ${tableName} row at index ${index}: missing row id.`)
        continue
      }

      rows.push({
        tableName,
        row: {
          ...row,
          id: row.id
        }
      })
    }
  }

  return rows
}

export class StorageV2LegacyDexieImportService {
  async importSnapshot(
    input: LegacyDexieSnapshot | string,
    options: StorageV2LegacyDexieImportOptions = {}
  ): Promise<StorageV2LegacyDexieImportReport> {
    const dryRun = options.dryRun !== false
    const snapshot = normalizeSnapshot(input)
    const warnings: string[] = []
    const conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : []
    const files = Array.isArray(snapshot.files) ? snapshot.files : []
    const settings = Array.isArray(snapshot.settings) ? snapshot.settings : []
    const normalizedSettings = settings.filter(
      (setting): setting is { id: string; value?: unknown } => typeof setting?.id === 'string' && setting.id.length > 0
    )
    const dexieTableRows = normalizeDexieTableRows(snapshot, warnings)
    const normalizedConversations = conversations
      .map((conversation, index) => normalizeConversation(conversation, index, warnings))
      .filter((conversation): conversation is StorageV2ConversationImport => Boolean(conversation))

    const messageCount = normalizedConversations.reduce(
      (count, conversation) => count + conversation.messages.length,
      0
    )
    const blockCount = normalizedConversations.reduce((count, conversation) => count + conversation.blocks.length, 0)
    let importedMessageCount = 0
    let importedBlockCount = 0
    let importedFileCount = 0
    let importedSettingCount = 0
    let importedDexieTableRowCount = 0
    let deletedConversationCount = 0
    let deletedFileCount = 0

    if (!dryRun) {
      for (const setting of normalizedSettings) {
        await storageV2SettingsRepository.set(`dexie.settings.${setting.id}`, setting.value ?? null, 'dexie-settings')
        importedSettingCount++
      }

      for (const { tableName, row } of dexieTableRows) {
        await storageV2SettingsRepository.set(
          toStorageV2DexieTableKey(tableName, row.id),
          row,
          `dexie-table:${tableName}`
        )
        importedDexieTableRowCount++
      }

      for (const conversation of normalizedConversations) {
        const result = await storageV2ConversationRepository.importConversation(conversation)
        importedMessageCount += result.messageCount
        importedBlockCount += result.blockCount
      }

      for (const file of files) {
        const result = await storageV2FileRepository.importFile(file)
        if (result.imported) {
          importedFileCount++
        } else if (result.skippedReason) {
          warnings.push(`Skipped legacy Dexie file ${file.id ?? file.path ?? 'unknown'}: ${result.skippedReason}.`)
        }
      }

      if (options.pruneMissing === true) {
        deletedConversationCount = await storageV2ConversationRepository.deleteMissingAssistantConversations(
          normalizedConversations.map((conversation) => conversation.id)
        )
        deletedFileCount = await storageV2FileRepository.deleteMissingLegacyFiles(
          files
            .map((file) => file.id)
            .filter((fileId): fileId is string => typeof fileId === 'string' && fileId.length > 0)
        )
      }
    }

    return {
      dryRun,
      conversationCount: normalizedConversations.length,
      messageCount,
      blockCount,
      fileCount: files.length,
      settingCount: normalizedSettings.length,
      dexieTableRowCount: dexieTableRows.length,
      importedConversationCount: dryRun ? 0 : normalizedConversations.length,
      importedMessageCount,
      importedBlockCount,
      importedFileCount,
      importedSettingCount,
      importedDexieTableRowCount,
      skippedFileCount: dryRun ? 0 : files.length - importedFileCount,
      deletedConversationCount,
      deletedFileCount,
      warnings
    }
  }
}

export const storageV2LegacyDexieImportService = new StorageV2LegacyDexieImportService()
