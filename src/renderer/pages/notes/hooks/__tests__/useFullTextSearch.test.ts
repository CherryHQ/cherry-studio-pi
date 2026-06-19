import type { SearchResult } from '@renderer/services/NotesSearchService'
import type { NotesTreeNode } from '@renderer/types/note'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  searchAllFiles: vi.fn()
}))

vi.mock('@renderer/services/NotesSearchService', () => ({
  searchAllFiles: mocks.searchAllFiles
}))

import { useFullTextSearch } from '../useFullTextSearch'

const makeNode = (id: string): NotesTreeNode => ({
  id,
  name: id,
  type: 'file',
  treePath: id,
  externalPath: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useFullTextSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.searchAllFiles.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a non-AbortError rejection after the active search is cancelled', async () => {
    const pendingSearch = deferred<SearchResult[]>()
    mocks.searchAllFiles.mockReturnValueOnce(pendingSearch.promise)
    const { result } = renderHook(() => useFullTextSearch({ debounceMs: 0 }))

    act(() => {
      result.current.search([makeNode('note.md')], 'needle')
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.isSearching).toBe(true)

    act(() => {
      result.current.cancel()
    })
    await act(async () => {
      pendingSearch.reject(new Error('late failure after abort'))
      await Promise.resolve()
    })

    expect(result.current.isSearching).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('releases the active abort controller after a successful search finishes', async () => {
    let capturedSignal: AbortSignal | undefined
    mocks.searchAllFiles.mockImplementationOnce(
      async (_nodes: NotesTreeNode[], _keyword: string, _options: unknown, signal?: AbortSignal) => {
        capturedSignal = signal
        return []
      }
    )
    const { result } = renderHook(() => useFullTextSearch({ debounceMs: 0 }))

    act(() => {
      result.current.search([makeNode('note.md')], 'needle')
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.isSearching).toBe(false)
    act(() => {
      result.current.cancel()
    })

    expect(capturedSignal?.aborted).toBe(false)
  })
})
