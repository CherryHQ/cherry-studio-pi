import type { SearchOptions, SearchResult } from '@renderer/services/NotesSearchService'
import { searchAllFiles } from '@renderer/services/NotesSearchService'
import type { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseFullTextSearchOptions extends SearchOptions {
  debounceMs?: number
  maxResults?: number
  enabled?: boolean
}

export interface UseFullTextSearchReturn {
  search: (nodes: NotesTreeNode[], keyword: string) => void
  cancel: () => void
  reset: () => void
  isSearching: boolean
  results: SearchResult[]
  stats: {
    total: number
    fileNameMatches: number
    contentMatches: number
    bothMatches: number
  }
  error: Error | null
}

/**
 * Full-text search hook for notes
 */
export function useFullTextSearch(options: UseFullTextSearchOptions = {}): UseFullTextSearchReturn {
  const { debounceMs = 300, maxResults = 100, enabled = true, ...searchOptions } = options

  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    fileNameMatches: 0,
    contentMatches: 0,
    bothMatches: 0
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)

  // Store options in refs to avoid reference changes
  const searchOptionsRef = useRef(searchOptions)
  const maxResultsRef = useRef(maxResults)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    searchOptionsRef.current = searchOptions
    maxResultsRef.current = maxResults
    enabledRef.current = enabled
  }, [searchOptions, maxResults, enabled])

  const cancelSearch = useCallback((updateSearching = true) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (updateSearching && mountedRef.current) {
      setIsSearching(false)
    }
  }, [])

  const cancel = useCallback(() => {
    cancelSearch()
  }, [cancelSearch])

  const reset = useCallback(() => {
    cancel()
    setResults([])
    setStats({ total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 })
    setError(null)
  }, [cancel])

  const performSearch = useCallback(
    async (nodes: NotesTreeNode[], keyword: string) => {
      if (!enabledRef.current) {
        return
      }

      cancelSearch(false)
      const normalizedKeyword = keyword.trim()

      if (!normalizedKeyword) {
        setResults([])
        setStats({ total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 })
        setError(null)
        setIsSearching(false)
        return
      }

      setIsSearching(true)
      setError(null)

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const searchResults = await searchAllFiles(
          nodes,
          normalizedKeyword,
          searchOptionsRef.current,
          abortController.signal
        )

        if (abortController.signal.aborted || !mountedRef.current) {
          return
        }

        const limitedResults = searchResults.slice(0, maxResultsRef.current)

        const newStats = {
          total: limitedResults.length,
          fileNameMatches: limitedResults.filter((r) => r.matchType === 'filename').length,
          contentMatches: limitedResults.filter((r) => r.matchType === 'content').length,
          bothMatches: limitedResults.filter((r) => r.matchType === 'both').length
        }

        setResults(limitedResults)
        setStats(newStats)
      } catch (err) {
        if (
          !abortController.signal.aborted &&
          mountedRef.current &&
          err instanceof Error &&
          err.name !== 'AbortError'
        ) {
          setError(err)
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
        if (!abortController.signal.aborted && mountedRef.current) {
          setIsSearching(false)
        }
      }
    },
    [cancelSearch]
  )

  const search = useCallback(
    (nodes: NotesTreeNode[], keyword: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        void performSearch(nodes, keyword)
      }, debounceMs)
    },
    [performSearch, debounceMs]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelSearch(false)
    }
  }, [cancelSearch])

  return {
    search,
    cancel,
    reset,
    isSearching,
    results,
    stats,
    error
  }
}
