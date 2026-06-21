import type { QuickPanelContextType, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourcePanel } from '../useResourcePanel'

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

const listDirectoryMock = vi.hoisted(() => vi.fn())

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span>{icon}</span>
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    loading: false,
    skills: []
  })
}))

vi.mock('lucide-react', () => ({
  Folder: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Zap: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: () => {},
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function createQuickPanelController(overrides: Partial<QuickPanelContextType> = {}): QuickPanelContextType {
  return {
    close: vi.fn(),
    defaultIndex: 0,
    isVisible: false,
    list: [],
    multiple: false,
    open: vi.fn(),
    pageSize: 7,
    symbol: '',
    updateItemSelection: vi.fn(),
    updateList: vi.fn(),
    ...overrides
  } as QuickPanelContextType
}

function createQuickPanelApi() {
  const rootEntries: QuickPanelListItem[][] = []
  const triggerHandlers: Array<(payload?: unknown) => void> = []
  const quickPanel: ToolQuickPanelApi = {
    registerRootMenu: vi.fn((entries) => {
      rootEntries.push(entries)
      return vi.fn()
    }),
    registerTrigger: vi.fn((_symbol, handler) => {
      triggerHandlers.push(handler)
      return vi.fn()
    })
  }

  return { quickPanel, rootEntries, triggerHandlers }
}

describe('useResourcePanel', () => {
  const originalApi = window.api

  beforeEach(() => {
    vi.useFakeTimers()
    listDirectoryMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...originalApi,
        file: {
          ...originalApi?.file,
          listDirectory: listDirectoryMock
        }
      }
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('clears deferred root-menu opens after unmount', () => {
    const { quickPanel, rootEntries } = createQuickPanelApi()
    const quickPanelController = createQuickPanelController()

    const { unmount } = renderHook(() =>
      useResourcePanel(
        {
          accessiblePaths: ['/workspace'],
          quickPanel,
          quickPanelController,
          setText: vi.fn()
        },
        'manager'
      )
    )

    const rootItem = rootEntries[0]?.[0]
    expect(rootItem).toBeTruthy()

    act(() => {
      rootItem?.action?.({
        action: 'click',
        context: {
          ...quickPanelController,
          triggerInfo: {
            originalText: '/',
            position: 0,
            type: 'input'
          }
        },
        item: rootItem
      })
    })

    expect(quickPanelController.close).toHaveBeenCalledWith('select')

    unmount()

    act(() => {
      vi.runAllTimers()
    })

    expect(listDirectoryMock).not.toHaveBeenCalled()
    expect(quickPanelController.open).not.toHaveBeenCalled()
  })

  it('does not open the panel when file loading completes after unmount', async () => {
    const pendingFiles = deferred<string[]>()
    listDirectoryMock.mockReturnValueOnce(pendingFiles.promise)
    const { quickPanel } = createQuickPanelApi()
    const quickPanelController = createQuickPanelController()

    const { result, unmount } = renderHook(() =>
      useResourcePanel({
        accessiblePaths: ['/workspace'],
        quickPanel,
        quickPanelController,
        setText: vi.fn()
      })
    )

    let openPromise!: Promise<void>
    act(() => {
      openPromise = result.current.openQuickPanel({ type: 'button' })
    })

    expect(listDirectoryMock).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({
        searchPattern: '.'
      })
    )

    unmount()

    await act(async () => {
      pendingFiles.resolve(['/workspace/notes.md'])
      await openPromise
    })

    expect(quickPanelController.open).not.toHaveBeenCalled()
  })

  it('opens from registered triggers while mounted', async () => {
    listDirectoryMock.mockResolvedValueOnce(['/workspace/notes.md'])
    const { quickPanel, triggerHandlers } = createQuickPanelApi()
    const quickPanelController = createQuickPanelController()

    renderHook(() =>
      useResourcePanel(
        {
          accessiblePaths: ['/workspace'],
          quickPanel,
          quickPanelController,
          setText: vi.fn()
        },
        'manager'
      )
    )

    await act(async () => {
      triggerHandlers[0]?.({
        originalText: '@no',
        position: 0,
        symbol: QuickPanelReservedSymbol.MentionModels,
        type: 'input'
      })
    })

    expect(quickPanelController.open).toHaveBeenCalledWith(
      expect.objectContaining({
        list: expect.arrayContaining([expect.objectContaining({ label: 'notes.md' })]),
        symbol: QuickPanelReservedSymbol.MentionModels
      })
    )
  })
})
