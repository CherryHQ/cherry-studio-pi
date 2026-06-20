import type { NotesTreeNode } from '@renderer/types/note'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchNoteSummary: vi.fn(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: mocks.loggerDebug,
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchNoteSummary: mocks.fetchNoteSummary
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { useNotesEditing } from '../useNotesEditing'

function makeNote(overrides: Partial<NotesTreeNode> = {}): NotesTreeNode {
  return {
    id: 'note-1',
    name: 'note',
    type: 'file',
    treePath: 'note.md',
    externalPath: '/notes/note.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useNotesEditing', () => {
  const readExternalMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(window as any).api = {
      file: {
        readExternal: readExternalMock
      }
    }
    ;(window as any).toast = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not rename or toast when auto rename resolves after unmount', async () => {
    const pendingContent = deferred<string>()
    const onRenameNode = vi.fn()
    readExternalMock.mockReturnValueOnce(pendingContent.promise)

    const { result, unmount } = renderHook(() => useNotesEditing({ onRenameNode }))

    let renamePromise!: Promise<void>
    act(() => {
      renamePromise = result.current.handleAutoRename(makeNote())
    })

    expect(result.current.renamingNodeIds.has('note-1')).toBe(true)

    unmount()

    await act(async () => {
      pendingContent.resolve('Some note content')
      await renamePromise
    })

    expect(mocks.fetchNoteSummary).not.toHaveBeenCalled()
    expect(onRenameNode).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.warning).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('clears the auto rename highlight timer on unmount', async () => {
    const onRenameNode = vi.fn()
    readExternalMock.mockResolvedValueOnce('Some note content')
    mocks.fetchNoteSummary.mockResolvedValueOnce('Generated title')

    const { result, unmount } = renderHook(() => useNotesEditing({ onRenameNode }))

    await act(async () => {
      await result.current.handleAutoRename(makeNote())
    })

    expect(onRenameNode).toHaveBeenCalledWith('note-1', 'Generated title')
    expect(result.current.newlyRenamedNodeIds.has('note-1')).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
