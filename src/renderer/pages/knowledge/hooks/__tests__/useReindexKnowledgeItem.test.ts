import { useReindexKnowledgeItem } from '@renderer/hooks/useKnowledgeItems'
import { createNoteItem } from '@renderer/pages/knowledge/panels/dataSource/__tests__/testUtils'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockReindexItems = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mockUseInvalidateCache()
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('useReindexKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockReindexItems.mockResolvedValue(undefined)
    ;(window as any).api = {
      knowledge: {
        reindexItems: mockReindexItems
      }
    }
  })

  it('reindexes one knowledge item through orchestration IPC and refreshes the list', async () => {
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).resolves.toBeUndefined()
    })

    expect(mockReindexItems).toHaveBeenCalledWith('base-1', ['note-1'])
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockReindexItems.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isReindexing).toBe(false)
  })

  it('keeps reindex rejected, refreshes items, and exposes inline error when orchestration rejects', async () => {
    const reindexError = new Error('reindex failed')
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockReindexItems.mockRejectedValueOnce(reindexError)
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).rejects.toBe(reindexError)
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockReindexItems.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBe(reindexError)
    expect(result.current.isReindexing).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to reindex knowledge source', reindexError, {
      baseId: 'base-1',
      itemId: 'note-1'
    })
  })

  it('keeps reindexing until the latest overlapping reindex completes', async () => {
    const firstReindex = deferred<void>()
    const secondReindex = deferred<void>()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockReindexItems.mockReturnValueOnce(firstReindex.promise).mockReturnValueOnce(secondReindex.promise)

    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    let firstReindexPromise!: Promise<void>
    let secondReindexPromise!: Promise<void>
    await act(async () => {
      firstReindexPromise = result.current.reindexItem(item)
      secondReindexPromise = result.current.reindexItem(item)
      await Promise.resolve()
    })

    expect(result.current.isReindexing).toBe(true)

    await act(async () => {
      firstReindex.resolve(undefined)
      await firstReindexPromise
    })

    expect(result.current.isReindexing).toBe(true)

    await act(async () => {
      secondReindex.resolve(undefined)
      await secondReindexPromise
    })

    expect(result.current.isReindexing).toBe(false)
  })
})
