import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile } from '@main/utils/file'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { FilePath } from '@shared/types/file'
import { net } from 'electron'

import { readMarkdownFromResponseZip } from './resultPersistence'

const logger = loggerService.withContext('MarkdownResultStore')
const ZIP_RESULT_CONTENT_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
])
const UNKNOWN_MARKDOWN_PERSISTENCE_ERROR = 'Unknown markdown persistence error'

export type MarkdownPersistencePayload =
  | {
      kind: 'markdown'
      markdownContent: string
    }
  | {
      kind: 'remote-zip-url'
      downloadUrl: string
      configuredApiHost: string
    }
  | {
      kind: 'response-zip'
      response: Response
    }

class MarkdownResultStore {
  async persistResultToPath(options: {
    jobId: string
    result: MarkdownPersistencePayload
    path: FilePath
    signal?: AbortSignal
  }): Promise<FilePath> {
    try {
      const data = await this.resolveMarkdownBytes(options)
      await atomicWriteFile(options.path, data)
      return options.path
    } catch (error) {
      logger.warn(
        'Markdown result path persistence failed',
        getSafeMarkdownPersistenceErrorForLog(error),
        getMarkdownPersistenceLogContext(options)
      )
      throw error
    }
  }

  private async resolveMarkdownBytes(options: {
    result: MarkdownPersistencePayload
    signal?: AbortSignal
  }): Promise<Uint8Array> {
    switch (options.result.kind) {
      case 'markdown':
        return new TextEncoder().encode(options.result.markdownContent)

      case 'response-zip':
        return await this.readMarkdownFromZipResponse(options.result.response, options.signal)

      case 'remote-zip-url': {
        const safeDownloadUrl = sanitizeRemoteUrl(options.result.downloadUrl, options.result.configuredApiHost)
        const response = await net.fetch(safeDownloadUrl, {
          method: 'GET',
          redirect: 'error',
          signal: options.signal
        })

        if (!response.ok) {
          throw new Error(`Markdown result download failed: ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type')
        if (!isZipResultContentType(contentType)) {
          throw new Error(`Markdown result download returned unexpected content-type: ${contentType}`)
        }

        return await this.readMarkdownFromZipResponse(response, options.signal)
      }
    }
  }

  private async readMarkdownFromZipResponse(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
    return await readMarkdownFromResponseZip({
      response,
      tempDir: application.getPath('feature.file_processing.temp'),
      signal
    })
  }
}

export const markdownResultStore = new MarkdownResultStore()

function isZipResultContentType(contentType: string | null): boolean {
  if (!contentType) return true

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return Boolean(mediaType && ZIP_RESULT_CONTENT_TYPES.has(mediaType))
}

function getMarkdownPersistenceLogContext(options: {
  jobId: string
  result: MarkdownPersistencePayload
}): Record<string, unknown> {
  const context: Record<string, unknown> = {
    jobId: options.jobId,
    resultKind: options.result.kind
  }

  if (options.result.kind === 'remote-zip-url') {
    context.downloadUrl = redactUrlQuery(options.result.downloadUrl)
    context.configuredApiHost = options.result.configuredApiHost
  }

  return context
}

function redactUrlQuery(url: string): string {
  try {
    const parsedUrl = new URL(url)
    return `${parsedUrl.origin}${parsedUrl.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

function getSafeMarkdownPersistenceErrorForLog(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(extractMarkdownPersistenceErrorMessage(error) ?? UNKNOWN_MARKDOWN_PERSISTENCE_ERROR)
  }

  if (error.message.startsWith('Markdown result download failed:')) {
    const safeError = new Error('Markdown result download failed')
    safeError.name = error.name
    return safeError
  }

  return error
}

function extractMarkdownPersistenceErrorMessage(error: unknown, seen = new WeakSet<object>()): string | null {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (!error || typeof error !== 'object') return null
  if (seen.has(error)) return null
  seen.add(error)

  const nestedError = (error as { error?: unknown }).error
  if (nestedError) {
    const nestedMessage = extractMarkdownPersistenceErrorMessage(nestedError, seen)
    if (nestedMessage) return nestedMessage
  }

  const message = (error as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) return message

  const cause = (error as { cause?: unknown }).cause
  if (cause) {
    const causeMessage = extractMarkdownPersistenceErrorMessage(cause, seen)
    if (causeMessage) return causeMessage
  }

  return null
}
