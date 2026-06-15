/**
 * Translate Language Service - handles translate language CRUD
 *
 * langCode is the primary key (immutable after creation).
 */

import { application } from '@application'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTranslateLanguageDto, UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { asc, eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TranslateLanguageService')

function rowToTranslateLanguage(row: typeof translateLanguageTable.$inferSelect): TranslateLanguage {
  return {
    langCode: parsePersistedLangCode(row.langCode),
    value: row.value,
    emoji: row.emoji,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TranslateLanguageService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  async list(): Promise<TranslateLanguage[]> {
    const rows = await this.db.select().from(translateLanguageTable).orderBy(asc(translateLanguageTable.createdAt))
    return rows.map(rowToTranslateLanguage)
  }

  async getByLangCode(langCode: string): Promise<TranslateLanguage> {
    const [row] = await this.db
      .select()
      .from(translateLanguageTable)
      .where(eq(translateLanguageTable.langCode, langCode))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
    }

    return rowToTranslateLanguage(row)
  }

  async create(dto: CreateTranslateLanguageDto): Promise<TranslateLanguage> {
    const langCode = parsePersistedLangCode(dto.langCode.toLowerCase())

    const [row] = await withSqliteErrors(
      () =>
        this.dbService.withWriteTx((tx) =>
          tx
            .insert(translateLanguageTable)
            .values({
              langCode,
              value: dto.value,
              emoji: dto.emoji
            })
            .returning()
        ),
      defaultHandlersFor('TranslateLanguage', langCode)
    )

    if (!row) {
      throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create translate language')
    }

    logger.info('Created translate language', { langCode })
    return rowToTranslateLanguage(row)
  }

  async update(langCode: string, dto: UpdateTranslateLanguageDto): Promise<TranslateLanguage> {
    const updates: Partial<typeof translateLanguageTable.$inferInsert> = {}
    if (dto.value !== undefined) updates.value = dto.value
    if (dto.emoji !== undefined) updates.emoji = dto.emoji

    if (Object.keys(updates).length === 0) {
      return this.getByLangCode(langCode)
    }

    const [row] = await this.dbService.withWriteTx((tx) =>
      tx.update(translateLanguageTable).set(updates).where(eq(translateLanguageTable.langCode, langCode)).returning()
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
    }

    logger.info('Updated translate language', { langCode, changes: Object.keys(dto) })
    return rowToTranslateLanguage(row)
  }

  async delete(langCode: string): Promise<void> {
    const [row] = await this.dbService.withWriteTx((tx) =>
      tx
        .delete(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .returning({ langCode: translateLanguageTable.langCode })
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
    }

    logger.info('Deleted translate language', { langCode })
  }
}

export const translateLanguageService = new TranslateLanguageService()
