import { createHash } from 'node:crypto'

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import type { KnowledgeItemData, KnowledgeItemType } from '@shared/data/types/knowledge'
import { asc, inArray } from 'drizzle-orm'

import { type StorageV2KnowledgeBaseImport, storageV2KnowledgeRepository } from './StorageV2Repositories'

const logger = loggerService.withContext('StorageV2KnowledgeMirrorService')

type KnowledgeBaseRow = typeof knowledgeBaseTable.$inferSelect
type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableContentHash(type: KnowledgeItemType, data: KnowledgeItemData) {
  return createHash('sha256')
    .update(`${type}:${JSON.stringify(data)}`)
    .digest('hex')
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value ? value : undefined
}

function getKnowledgeItemContent(row: KnowledgeItemRow): unknown {
  const data = row.data
  if (!isRecord(data)) return ''
  const record = data as Record<string, unknown>

  switch (row.type) {
    case 'file':
      return {
        id: stringField(record, 'fileEntryId'),
        path:
          stringField(record, 'indexedRelativePath') ??
          stringField(record, 'relativePath') ??
          stringField(record, 'source'),
        name: stringField(record, 'source')
      }
    case 'url':
      return stringField(record, 'url') ?? stringField(record, 'source') ?? ''
    case 'directory':
      return stringField(record, 'path') ?? stringField(record, 'source') ?? ''
    case 'note':
      return stringField(record, 'source') ?? ''
    default:
      return stringField(record, 'source') ?? ''
  }
}

function toKnowledgeItemSnapshot(row: KnowledgeItemRow): Record<string, unknown> {
  return {
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    content: getKnowledgeItemContent(row),
    data: row.data,
    uniqueId: stableContentHash(row.type, row.data),
    processingStatus: row.status,
    error: row.error,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  }
}

function toKnowledgeBaseSnapshot(
  row: KnowledgeBaseRow,
  items: Record<string, unknown>[]
): StorageV2KnowledgeBaseImport {
  return {
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    dimensions: row.dimensions,
    embeddingModelId: row.embeddingModelId,
    status: row.status,
    error: row.error,
    rerankModelId: row.rerankModelId,
    fileProcessorId: row.fileProcessorId,
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    threshold: row.threshold,
    documentCount: row.documentCount,
    searchMode: row.searchMode,
    hybridAlpha: row.hybridAlpha,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    items
  }
}

export class StorageV2KnowledgeMirrorService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async flushStrict(): Promise<{ baseCount: number; itemCount: number }> {
    const baseRows = await this.db
      .select()
      .from(knowledgeBaseTable)
      .orderBy(asc(knowledgeBaseTable.createdAt), asc(knowledgeBaseTable.id))

    const baseIds = baseRows.map((row) => row.id)
    const itemRows =
      baseIds.length > 0
        ? await this.db
            .select()
            .from(knowledgeItemTable)
            .where(inArray(knowledgeItemTable.baseId, baseIds))
            .orderBy(asc(knowledgeItemTable.baseId), asc(knowledgeItemTable.createdAt), asc(knowledgeItemTable.id))
        : []

    const itemsByBaseId = new Map<string, Record<string, unknown>[]>()
    for (const row of itemRows) {
      const items = itemsByBaseId.get(row.baseId) ?? []
      items.push(toKnowledgeItemSnapshot(row))
      itemsByBaseId.set(row.baseId, items)
    }

    const bases = baseRows.map((row) => toKnowledgeBaseSnapshot(row, itemsByBaseId.get(row.id) ?? []))
    const report = await storageV2KnowledgeRepository.importBases(bases, { pruneMissing: true })

    logger.debug('Mirrored knowledge database to Storage v2', {
      baseCount: report.baseCount,
      itemCount: report.itemCount,
      deletedBaseCount: report.deletedBaseCount,
      deletedItemCount: report.deletedItemCount
    })

    return {
      baseCount: report.baseCount,
      itemCount: report.itemCount
    }
  }

  async flushBestEffort(reason: string): Promise<void> {
    try {
      await this.flushStrict()
    } catch (error) {
      logger.warn('Failed to mirror knowledge database to Storage v2', {
        reason,
        error
      })
    }
  }
}

export const storageV2KnowledgeMirrorService = new StorageV2KnowledgeMirrorService()
