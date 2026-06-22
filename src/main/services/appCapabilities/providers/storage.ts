import { loggerService } from '@logger'
import { flushMainStorageV2RuntimeMirrors } from '@main/services/AppRuntimeSaveService'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import { RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE } from '@shared/dataSyncBridge'

import { callRendererBridge, getBridgeErrorMessage } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapability:Storage')
const DEFAULT_AGENT_LIST_LIMIT = 50
const MAX_AGENT_LIST_LIMIT = 200
const RENDERER_PREPARE_STORAGE_V2_CHECK_TIMEOUT_MS = 800
const RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS = 1_500
const STORAGE_LIST_LIMIT_NUMBER_ERROR = '存储列表 limit 必须是数字。'
const STORAGE_LIST_OFFSET_NUMBER_ERROR = '存储列表 offset 必须是数字。'
const STORAGE_INPUT_OBJECT_ERROR = '存储能力的输入必须是对象。'
const STORAGE_ABORT_ERROR = '存储能力调用已取消。'
const BACKUP_REASON_LABEL = '备份原因'
const SNAPSHOT_REASON_LABEL = '快照原因'
const BACKUP_PATH_LABEL = '备份路径'
const OWNER_TYPE_LABEL = '归属类型'
const OWNER_ID_LABEL = '归属 ID'
const CONVERSATION_ID_LABEL = '对话 ID'
const FILE_ID_LABEL = '文件 ID'
const STORAGE_DATA_ROOT_READ_SUMMARY = '已读取存储数据目录'
const STORAGE_HEALTH_CHECKED_SUMMARY = '存储健康检查已完成'
const STORAGE_STATS_READ_SUMMARY = '已读取存储统计信息'
const BACKUP_CREATED_PREFIX = '已创建备份：'
const BACKUP_ARTIFACT_TITLE = 'Storage v2 备份'
const BACKUP_OVERVIEW_READ_SUMMARY = '已读取备份概览'
const BACKUP_VALIDATED_SUMMARY = '备份校验已完成'
const BACKUP_RESTORE_DRY_RUN_SUMMARY = '备份恢复演练已完成'
const BACKUP_RESTORED_SUMMARY = '备份恢复已完成'
const STORAGE_SNAPSHOT_CREATED_SUMMARY = '存储快照已创建'
const PROVIDERS_LISTED_SUMMARY = '已列出模型服务商'
const ASSISTANTS_LISTED_SUMMARY = '已列出助手'
const CONVERSATIONS_LISTED_SUMMARY = '已列出对话'
const CONVERSATION_MESSAGES_LISTED_SUMMARY = '已列出对话消息'
const FILES_LISTED_SUMMARY = '已列出文件记录'
const FILE_RECORD_READ_SUMMARY = '已读取文件记录'
const STORAGE_OPERATION_BACKUP = '备份'
const STORAGE_OPERATION_RESTORE = '恢复'
const STORAGE_OPERATION_SNAPSHOT = '快照'

function normalizeListLimit(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(STORAGE_LIST_LIMIT_NUMBER_ERROR)
  }
  const parsed =
    typeof value === 'string' && !value.trim() ? DEFAULT_AGENT_LIST_LIMIT : Number(value ?? DEFAULT_AGENT_LIST_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_AGENT_LIST_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_AGENT_LIST_LIMIT))
}

function normalizeOffset(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(STORAGE_LIST_OFFSET_NUMBER_ERROR)
  }
  const parsed = typeof value === 'string' && !value.trim() ? undefined : Number(value)
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.trunc(parsed))
}

function normalizeOptionalText(value: unknown, label = '输入值') {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  throw new Error(label + ' 必须是字符串。')
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(label + ' 不能为空。')
  return text
}

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(STORAGE_INPUT_OBJECT_ERROR)
  return input as Record<string, unknown>
}

function throwIfStorageSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error(STORAGE_ABORT_ERROR)
}

function agentListOptions(input: unknown = {}) {
  const inputObject = normalizeInputObject(input)
  return {
    limit: normalizeListLimit(inputObject.limit),
    offset: normalizeOffset(inputObject.offset)
  }
}

async function prepareRendererStorageV2ForStorageOperation(operation: string, signal?: AbortSignal) {
  throwIfStorageSignalAborted(signal)
  await flushMainStorageV2RuntimeMirrors()
  throwIfStorageSignalAborted(signal)

  try {
    await callRendererBridge<void>(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE, undefined, {
      checkTimeoutMs: RENDERER_PREPARE_STORAGE_V2_CHECK_TIMEOUT_MS,
      timeoutMs: RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS,
      timeoutMessage: '准备本地存储数据超时，操作尚未开始：' + operation,
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw error
    logger.warn('Renderer Storage v2 preparation bridge is unavailable; continuing with persisted Storage v2 data', {
      operation,
      error: getBridgeErrorMessage(error)
    })
  }
}

export function createStorageCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'storage.dataRoot.get',
      domain: 'storage',
      kind: 'query',
      title: 'Get data root',
      description: 'Return the active Storage v2 data root.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['storage', 'data', 'path'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfStorageSignalAborted(context.signal)
        return okResult(STORAGE_DATA_ROOT_READ_SUMMARY, { dataRoot: storageV2Service.getDataRoot() })
      }
    },
    {
      id: 'storage.health.check',
      domain: 'storage',
      kind: 'query',
      title: 'Check storage health',
      description: 'Run a Storage v2 health check.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['storage', 'health', 'database'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfStorageSignalAborted(context.signal)
        const health = await storageV2Service.healthCheck()
        throwIfStorageSignalAborted(context.signal)
        return okResult(STORAGE_HEALTH_CHECKED_SUMMARY, sanitizeForAgent(health))
      }
    },
    {
      id: 'storage.stats.get',
      domain: 'storage',
      kind: 'query',
      title: 'Get storage statistics',
      description: 'Read Storage v2 statistics such as entity counts.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['storage', 'stats', 'database'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfStorageSignalAborted(context.signal)
        const stats = await storageV2Service.getStats()
        throwIfStorageSignalAborted(context.signal)
        return okResult(STORAGE_STATS_READ_SUMMARY, sanitizeForAgent(stats))
      }
    },
    {
      id: 'storage.backup.create',
      domain: 'storage',
      kind: 'command',
      title: 'Create local backup',
      description: 'Create a local Storage v2 backup of user data.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason stored in backup metadata' }
        }
      },
      risk: 'write',
      permissions: ['storage.backup.write'],
      sideEffects: ['database.read', 'filesystem.read', 'filesystem.write'],
      tags: ['storage', 'backup', 'local', 'data'],
      examples: ['Create a local backup', 'Back up my data before changing settings'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const reason = normalizeOptionalText(inputObject.reason, BACKUP_REASON_LABEL) || 'agent-request'
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation(STORAGE_OPERATION_BACKUP, context.signal)
        throwIfStorageSignalAborted(context.signal)
        const backup = await storageV2Service.createBackup(reason)
        throwIfStorageSignalAborted(context.signal)
        return {
          ok: true,
          summary: BACKUP_CREATED_PREFIX + backup.path,
          data: sanitizeForAgent(backup),
          artifacts: [{ type: 'backup', path: backup.path, title: BACKUP_ARTIFACT_TITLE }]
        }
      }
    },
    {
      id: 'storage.backup.overview',
      domain: 'storage',
      kind: 'query',
      title: 'Get backup overview',
      description: 'List recent Storage v2 backups and backup overview information.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['storage', 'backup', 'list'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfStorageSignalAborted(context.signal)
        const overview = await storageV2Service.getBackupOverview()
        throwIfStorageSignalAborted(context.signal)
        return okResult(BACKUP_OVERVIEW_READ_SUMMARY, sanitizeForAgent(overview))
      }
    },
    {
      id: 'storage.backup.validate',
      domain: 'storage',
      kind: 'query',
      title: 'Validate backup',
      description: 'Validate that a Storage v2 backup path is restorable.',
      inputSchema: {
        type: 'object',
        properties: {
          backupPath: { type: 'string', description: 'Path to a Storage v2 backup directory' }
        },
        required: ['backupPath']
      },
      risk: 'read',
      tags: ['storage', 'backup', 'validate'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const backupPath = normalizeRequiredText(inputObject.backupPath, BACKUP_PATH_LABEL)
        throwIfStorageSignalAborted(context.signal)
        const validation = await storageV2Service.validateBackup(backupPath)
        throwIfStorageSignalAborted(context.signal)
        return okResult(BACKUP_VALIDATED_SUMMARY, sanitizeForAgent(validation))
      }
    },
    {
      id: 'storage.backup.restore',
      domain: 'storage',
      kind: 'command',
      title: 'Restore backup',
      description: 'Restore a Storage v2 backup. This replaces local application data and is destructive.',
      inputSchema: {
        type: 'object',
        properties: {
          backupPath: { type: 'string', description: 'Path to a Storage v2 backup directory' }
        },
        required: ['backupPath']
      },
      risk: 'destructive',
      permissions: ['storage.backup.restore'],
      sideEffects: ['database.read', 'database.write', 'filesystem.read', 'filesystem.write', 'filesystem.delete'],
      supportsDryRun: true,
      tags: ['storage', 'backup', 'restore'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const backupPath = normalizeRequiredText(inputObject.backupPath, BACKUP_PATH_LABEL)
        if (context.dryRun) {
          throwIfStorageSignalAborted(context.signal)
          const validation = await storageV2Service.validateBackup(backupPath)
          throwIfStorageSignalAborted(context.signal)
          return okResult(BACKUP_RESTORE_DRY_RUN_SUMMARY, {
            validation: sanitizeForAgent(validation)
          })
        }
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation(STORAGE_OPERATION_RESTORE, context.signal)
        throwIfStorageSignalAborted(context.signal)
        const restore = await storageV2Service.restoreBackup(backupPath)
        throwIfStorageSignalAborted(context.signal)
        return okResult(BACKUP_RESTORED_SUMMARY, sanitizeForAgent(restore))
      }
    },
    {
      id: 'storage.snapshot.create',
      domain: 'storage',
      kind: 'command',
      title: 'Create storage snapshot',
      description: 'Create a Storage v2 database snapshot for diagnostics or migrations.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason stored in snapshot metadata' }
        }
      },
      risk: 'write',
      permissions: ['storage.snapshot.write'],
      sideEffects: ['database.read', 'database.write', 'filesystem.write'],
      tags: ['storage', 'snapshot', 'database'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const reason = normalizeOptionalText(inputObject.reason, SNAPSHOT_REASON_LABEL) || 'agent-request'
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation(STORAGE_OPERATION_SNAPSHOT, context.signal)
        throwIfStorageSignalAborted(context.signal)
        const snapshot = await storageV2Service.createSnapshot(reason)
        throwIfStorageSignalAborted(context.signal)
        return okResult(STORAGE_SNAPSHOT_CREATED_SUMMARY, sanitizeForAgent(snapshot))
      }
    },
    {
      id: 'storage.providers.list',
      domain: 'storage',
      kind: 'query',
      title: 'List model providers',
      description: 'List model provider records from Storage v2 with secrets redacted.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['storage', 'models', 'providers', 'settings'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfStorageSignalAborted(context.signal)
        const providers = await storageV2Service.listProviders()
        throwIfStorageSignalAborted(context.signal)
        return okResult(PROVIDERS_LISTED_SUMMARY, sanitizeForAgent(providers))
      }
    },
    {
      id: 'storage.assistants.list',
      domain: 'storage',
      kind: 'query',
      title: 'List assistants',
      description: 'List assistant records from Storage v2.',
      risk: 'read',
      tags: ['storage', 'assistants'],
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum assistants to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' }
        }
      },
      execute: async (input: any, context) => {
        const options = agentListOptions(input)
        throwIfStorageSignalAborted(context.signal)
        const assistants = await storageV2Service.listAssistants(options)
        throwIfStorageSignalAborted(context.signal)
        return okResult(ASSISTANTS_LISTED_SUMMARY, sanitizeForAgent(assistants))
      }
    },
    {
      id: 'storage.conversations.list',
      domain: 'storage',
      kind: 'query',
      title: 'List conversations',
      description: 'List conversation records from Storage v2.',
      inputSchema: {
        type: 'object',
        properties: {
          ownerType: { type: 'string' },
          ownerId: { type: 'string' },
          limit: {
            type: 'number',
            description: 'Maximum conversations to return; defaults to 50 and is capped at 200'
          },
          offset: { type: 'number', description: 'Pagination offset' }
        }
      },
      risk: 'read',
      tags: ['storage', 'conversations', 'chat'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const options = {
          ownerType: normalizeOptionalText(inputObject.ownerType, OWNER_TYPE_LABEL),
          ownerId: normalizeOptionalText(inputObject.ownerId, OWNER_ID_LABEL),
          ...agentListOptions(inputObject)
        }
        throwIfStorageSignalAborted(context.signal)
        const conversations = await storageV2Service.listConversations(options)
        throwIfStorageSignalAborted(context.signal)
        return okResult(CONVERSATIONS_LISTED_SUMMARY, sanitizeForAgent(conversations))
      }
    },
    {
      id: 'storage.messages.list',
      domain: 'storage',
      kind: 'query',
      title: 'List conversation messages',
      description: 'List messages for a Storage v2 conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          limit: { type: 'number', description: 'Maximum messages to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number' }
        },
        required: ['conversationId']
      },
      risk: 'read',
      tags: ['storage', 'messages', 'conversations', 'chat'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const conversationId = normalizeRequiredText(inputObject.conversationId, CONVERSATION_ID_LABEL)
        const options = agentListOptions(inputObject)
        throwIfStorageSignalAborted(context.signal)
        const messages = await storageV2Service.listMessages(conversationId, options)
        throwIfStorageSignalAborted(context.signal)
        return okResult(CONVERSATION_MESSAGES_LISTED_SUMMARY, sanitizeForAgent(messages))
      }
    },
    {
      id: 'storage.files.list',
      domain: 'storage',
      kind: 'query',
      title: 'List files',
      description: 'List file records from Storage v2.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum files to return; defaults to 50 and is capped at 200' },
          offset: { type: 'number', description: 'Pagination offset' }
        }
      },
      risk: 'read',
      tags: ['storage', 'files'],
      execute: async (input: any, context) => {
        const options = agentListOptions(input)
        throwIfStorageSignalAborted(context.signal)
        const files = await storageV2Service.listFiles(options)
        throwIfStorageSignalAborted(context.signal)
        return okResult(FILES_LISTED_SUMMARY, sanitizeForAgent(files))
      }
    },
    {
      id: 'storage.file.get',
      domain: 'storage',
      kind: 'query',
      title: 'Get file record',
      description: 'Read one file record from Storage v2 by file id.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' }
        },
        required: ['fileId']
      },
      risk: 'read',
      tags: ['storage', 'files', 'read'],
      execute: async (input: any, context) => {
        const inputObject = normalizeInputObject(input)
        const fileId = normalizeRequiredText(inputObject.fileId, FILE_ID_LABEL)
        throwIfStorageSignalAborted(context.signal)
        const file = await storageV2Service.getFile(fileId)
        throwIfStorageSignalAborted(context.signal)
        return okResult(FILE_RECORD_READ_SUMMARY, sanitizeForAgent(file))
      }
    }
  ]
}
