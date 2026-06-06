import { loggerService } from '@logger'
import { summarizeTextForLog } from '@renderer/aiCore/utils/logging'
import type { NotesTreeNode } from '@renderer/types/note'

const logger = loggerService.withContext('NotesSearchService')

/**
 * Search match result
 */
export interface SearchMatch {
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
  context: string
}

/**
 * Search result with match information
 */
export interface SearchResult extends NotesTreeNode {
  matchType: 'filename' | 'content' | 'both'
  matches?: SearchMatch[]
  score: number
}

/**
 * Search options
 */
export interface SearchOptions {
  caseSensitive?: boolean
  useRegex?: boolean
  maxFileSize?: number
  maxMatchesPerFile?: number
  contextLength?: number
}

/**
 * Escape regex special characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Calculate relevance score
 * - Filename match has higher priority
 * - More matches increase score
 * - More recent updates increase score
 */
export function calculateRelevanceScore(node: NotesTreeNode, keyword: string, matches: SearchMatch[]): number {
  let score = 0

  // Exact filename match (highest weight)
  if (node.name.toLowerCase() === keyword.toLowerCase()) {
    score += 200
  }
  // Filename contains match (high weight)
  else if (node.name.toLowerCase().includes(keyword.toLowerCase())) {
    score += 100
  }

  // Content match count
  score += Math.min(matches.length * 2, 50)

  // Recent updates boost score
  const daysSinceUpdate = (Date.now() - new Date(node.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  score += Math.max(0, 10 - daysSinceUpdate)

  return score
}

/**
 * Search file content for keyword matches
 */
export async function searchFileContent(
  node: NotesTreeNode,
  keyword: string,
  options: SearchOptions = {}
): Promise<SearchResult | null> {
  const {
    caseSensitive = false,
    useRegex = false,
    maxFileSize = 10 * 1024 * 1024, // 10MB
    maxMatchesPerFile = 50,
    contextLength = 50
  } = options

  try {
    if (node.type !== 'file') {
      return null
    }

    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) {
      return null
    }

    const content = await window.api.file.readExternal(node.externalPath)

    if (!content) {
      return null
    }

    if (content.length > maxFileSize) {
      logger.warn('File too large to search', {
        externalPath: summarizeTextForLog(node.externalPath),
        size: content.length,
        maxFileSize
      })
      return null
    }

    const flags = caseSensitive ? 'g' : 'gi'
    const pattern = useRegex ? new RegExp(normalizedKeyword, flags) : new RegExp(escapeRegex(normalizedKeyword), flags)

    const lines = content.split('\n')
    const matches: SearchMatch[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        if (match[0].length === 0) {
          pattern.lastIndex += 1
          continue
        }

        const matchStart = match.index
        const matchEnd = matchStart + match[0].length

        // Keep context short: only 2 chars before match, more after
        const beforeMatch = Math.min(2, matchStart)
        const contextStart = matchStart - beforeMatch
        const contextEnd = Math.min(line.length, matchEnd + contextLength)

        // Add ellipsis if context doesn't start at line beginning
        const prefix = contextStart > 0 ? '...' : ''
        const contextText = prefix + line.substring(contextStart, contextEnd)

        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: beforeMatch + prefix.length,
          matchEnd: matchEnd - matchStart + beforeMatch + prefix.length,
          context: contextText
        })

        if (matches.length >= maxMatchesPerFile) {
          break
        }
      }

      if (matches.length >= maxMatchesPerFile) {
        break
      }
    }

    if (matches.length === 0) {
      return null
    }

    const score = calculateRelevanceScore(node, normalizedKeyword, matches)

    return {
      ...node,
      matchType: 'content',
      matches,
      score
    }
  } catch (error) {
    logger.error('Failed to search file content', { externalPath: summarizeTextForLog(node.externalPath), error })
    return null
  }
}

/**
 * Check if filename matches keyword
 */
export function matchFileName(node: NotesTreeNode, keyword: string, caseSensitive = false): boolean {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) return false

  const name = caseSensitive ? node.name : node.name.toLowerCase()
  const key = caseSensitive ? normalizedKeyword : normalizedKeyword.toLowerCase()
  return name.includes(key)
}

/**
 * Flatten tree to extract file nodes
 */
export function flattenTreeToFiles(nodes: NotesTreeNode[]): NotesTreeNode[] {
  const result: NotesTreeNode[] = []
  const stack = [...nodes].reverse()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue

    if (node.type === 'file') {
      result.push(node)
    }

    if (node.children && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index])
      }
    }
  }

  return result
}

/**
 * Search all files concurrently
 */
export async function searchAllFiles(
  nodes: NotesTreeNode[],
  keyword: string,
  options: SearchOptions = {},
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const startTime = performance.now()
  const CONCURRENCY = 5
  const results: SearchResult[] = []
  const normalizedKeyword = keyword.trim()

  if (!normalizedKeyword) {
    return []
  }

  const fileNodes = flattenTreeToFiles(nodes)

  logger.debug('Starting full-text search', {
    keyword: summarizeTextForLog(normalizedKeyword),
    totalFiles: fileNodes.length,
    options
  })

  let nextFileIndex = 0

  const worker = async () => {
    while (nextFileIndex < fileNodes.length) {
      if (signal?.aborted) {
        break
      }

      const node = fileNodes[nextFileIndex++]
      if (!node) break

      const nameMatch = matchFileName(node, normalizedKeyword, options.caseSensitive)
      const contentResult = await searchFileContent(node, normalizedKeyword, options)

      if (nameMatch && contentResult) {
        results.push({
          ...contentResult,
          matchType: 'both',
          score: contentResult.score + 100
        })
      } else if (nameMatch) {
        results.push({
          ...node,
          matchType: 'filename',
          matches: [],
          score: 100
        })
      } else if (contentResult) {
        results.push(contentResult)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fileNodes.length) }, () => worker()))

  const sortedResults = results.sort((a, b) => b.score - a.score)

  const endTime = performance.now()
  const duration = (endTime - startTime).toFixed(2)
  const matchCounts = sortedResults.reduce(
    (counts, result) => {
      counts[result.matchType] += 1
      return counts
    },
    { filename: 0, content: 0, both: 0 }
  )

  logger.debug('Full-text search completed', {
    keyword: summarizeTextForLog(normalizedKeyword),
    durationMs: Number(duration),
    totalFiles: fileNodes.length,
    resultsFound: sortedResults.length,
    filenameMatches: matchCounts.filename,
    contentMatches: matchCounts.content,
    bothMatches: matchCounts.both
  })

  return sortedResults
}
