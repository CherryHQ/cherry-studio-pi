import { loggerService } from '@logger'
import { storageV2Service } from '@main/services/storageV2/StorageService'
import { RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE } from '@shared/dataSyncBridge'

import { callRendererBridge, getBridgeErrorMessage } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { okResult, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapability:Storage')
const DEFAULT_AGENT_LIST_LIMIT = 50
const MAX_AGENT_LIST_LIMIT = 200
const RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS = 5 * 60_000

function normalizeListLimit(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Storage list limit must be a number')
  }
  const parsed =
    typeof value === 'string' && !value.trim() ? DEFAULT_AGENT_LIST_LIMIT : Number(value ?? DEFAULT_AGENT_LIST_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_AGENT_LIST_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_AGENT_LIST_LIMIT))
}

function normalizeOffset(value: unknown) {
  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Storage list offset must be a number')
  }
  const parsed = typeof value === 'string' && !value.trim() ? undefined : Number(value)
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.trunc(parsed))
}

function normalizeOptionalText(value: unknown, label = 'Value') {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value === null || typeof value === 'undefined') return undefined
  throw new Error(`${label} must be a string`)
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(`${label} is required`)
  return text
}

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Storage capability input must be an object')
  return input as Record<string, unknown>
}

function throwIfStorageSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error('Storage capability call aborted')
}

function agentListOptions(input: unknown = {}) {
  const inputObject = normalizeInputObject(input)
  return {
    limit: normalizeListLimit(inputObject.limit),
    offset: normalizeOffset(inputObject.offset)
  }
}

async function prepareRendererStorageV2ForStorageOperation(operation: string, signal?: AbortSignal) {
  try {
    await callRendererBridge<void>(RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE, undefined, {
      timeoutMs: RENDERER_PREPARE_STORAGE_V2_TIMEOUT_MS,
      timeoutMessage: `Timed out preparing local data before ${operation}`,
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
        return okResult('Storage data root read', { dataRoot: storageV2Service.getDataRoot() })
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
        return okResult('Storage health checked', sanitizeForAgent(health))
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
        return okResult('Storage statistics read', sanitizeForAgent(stats))
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
        const reason = normalizeOptionalText(inputObject.reason, 'Backup reason') || 'agent-request'
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation('backup', context.signal)
        throwIfStorageSignalAborted(context.signal)
        const backup = await storageV2Service.createBackup(reason)
        throwIfStorageSignalAborted(context.signal)
        return {
          ok: true,
          summary: `Backup created: ${backup.path}`,
          data: sanitizeForAgent(backup),
          artifacts: [{ type: 'backup', path: backup.path, title: 'Storage v2 backup' }]
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
        return okResult('Backup overview read', sanitizeForAgent(overview))
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
        const backupPath = normalizeRequiredText(inputObject.backupPath, 'Backup path')
        throwIfStorageSignalAborted(context.signal)
        const validation = await storageV2Service.validateBackup(backupPath)
        throwIfStorageSignalAborted(context.signal)
        return okResult('Backup validated', sanitizeForAgent(validation))
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
        const backupPath = normalizeRequiredText(inputObject.backupPath, 'Backup path')
        if (context.dryRun) {
          throwIfStorageSignalAborted(context.signal)
          const validation = await storageV2Service.validateBackup(backupPath)
          throwIfStorageSignalAborted(context.signal)
          return okResult('Backup restore dry run completed', {
            validation: sanitizeForAgent(validation)
          })
        }
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation('restore', context.signal)
        throwIfStorageSignalAborted(context.signal)
        const restore = await storageV2Service.restoreBackup(backupPath)
        throwIfStorageSignalAborted(context.signal)
        return okResult('Backup restored', sanitizeForAgent(restore))
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
        const reason = normalizeOptionalText(inputObject.reason, 'Snapshot reason') || 'agent-request'
        throwIfStorageSignalAborted(context.signal)
        await prepareRendererStorageV2ForStorageOperation('snapshot', context.signal)
        throwIfStorageSignalAborted(context.signal)
        const snapshot = await storageV2Service.createSnapshot(reason)
        throwIfStorageSignalAborted(context.signal)
        return okResult('Storage snapshot created', sanitizeForAgent(snapshot))
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
        return okResult('Providers listed', sanitizeForAgent(providers))
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
        return okResult('Assistants listed', sanitizeForAgent(assistants))
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
          ownerType: normalizeOptionalText(inputObject.ownerType, 'Owner type'),
          ownerId: normalizeOptionalText(inputObject.ownerId, 'Owner id'),
          ...agentListOptions(inputObject)
        }
        throwIfStorageSignalAborted(context.signal)
        const conversations = await storageV2Service.listConversations(options)
        throwIfStorageSignalAborted(context.signal)
        return okResult('Conversations listed', sanitizeForAgent(conversations))
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
        const conversationId = normalizeRequiredText(inputObject.conversationId, 'Conversation id')
        const options = agentListOptions(inputObject)
        throwIfStorageSignalAborted(context.signal)
        const messages = await storageV2Service.listMessages(conversationId, options)
        throwIfStorageSignalAborted(context.signal)
        return okResult('Conversation messages listed', sanitizeForAgent(messages))
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
        return okResult('Files listed', sanitizeForAgent(files))
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
        const fileId = normalizeRequiredText(inputObject.fileId, 'File id')
        throwIfStorageSignalAborted(context.signal)
        const file = await storageV2Service.getFile(fileId)
        throwIfStorageSignalAborted(context.signal)
        return okResult('File record read', sanitizeForAgent(file))
      }
    }
  ]
}
