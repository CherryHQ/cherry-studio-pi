import { loggerService } from '@logger'
import { summarizeTextForLog, summarizeUrlForLog } from '@main/utils/logging'
import { DEFAULT_MAX_RESPONSE_TEXT_BYTES, readResponseTextWithinLimit } from '@main/utils/readResponseText'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { Readability } from '@mozilla/readability'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

import { isAbortError } from './errors'

const logger = loggerService.withContext('MainWebSearchContentFetcher')
const turndownService = new TurndownService()
const SAFE_JSDOM_URL = 'http://localhost/'
export const MAX_WEB_SEARCH_CONTENT_BYTES = DEFAULT_MAX_RESPONSE_TEXT_BYTES

function buildHeaders(headers?: HeadersInit) {
  const resolvedHeaders = new Headers(headers)

  if (!resolvedHeaders.has('User-Agent')) {
    resolvedHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
  }

  return resolvedHeaders
}

export async function fetchWebSearchContent(url: string, httpOptions: RequestInit = {}): Promise<WebSearchResult> {
  try {
    const safeUrl = sanitizeRemoteUrl(url)

    const response = await net.fetch(safeUrl, {
      ...httpOptions,
      headers: buildHeaders(httpOptions.headers),
      signal: httpOptions.signal
        ? AbortSignal.any([httpOptions.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000)
    })

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`)
    }

    const {
      text: html,
      truncated,
      bytesRead
    } = await readResponseTextWithinLimit(response, MAX_WEB_SEARCH_CONTENT_BYTES)
    if (truncated) {
      logger.warn('Web search content truncated before readability parsing', {
        url: summarizeUrlForLog(safeUrl),
        bytesRead
      })
    }

    const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })
    const article = new Readability(dom.window.document).parse()
    const markdown = turndownService.turndown(article?.content || '').trim()

    return {
      title: article?.title || safeUrl,
      url: safeUrl,
      content: markdown,
      sourceInput: url
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch web search content', {
      url: summarizeUrlForLog(url),
      errorName: normalizedError.name,
      error: summarizeTextForLog(normalizedError.message)
    })
    throw error
  }
}
