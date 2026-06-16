import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatContextProvider } from '../useChatContext'

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  deleteMessage: vi.fn(),
  fileSave: vi.fn(),
  loggerError: vi.fn(),
  modalConfirm: vi.fn(),
  setMultiSelectMode: vi.fn(),
  setSelectedMessageIds: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: (key: string) => {
    if (key === 'chat.multi_select_mode') return [true, mocks.setMultiSelectMode]
    if (key === 'chat.selected_message_ids') return [['m1'], mocks.setSelectedMessageIds]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@renderer/hooks/V2ChatContext', () => ({
  useV2Chat: () => ({
    deleteMessage: mocks.deleteMessage
  })
}))

vi.mock('@renderer/pages/home/Messages/Blocks', () => ({
  usePartsMap: () => ({
    m1: [{ text: 'hello from selected message' }]
  })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { CHANGE_TOPIC: 'CHANGE_TOPIC' },
  EventEmitter: {
    on: vi.fn(() => mocks.unsubscribe)
  }
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('@renderer/utils/messageUtils/partsHelpers', () => ({
  getTextFromParts: (parts: Array<{ text?: string }>) => parts.map((part) => part.text ?? '').join('')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useChatContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          save: mocks.fileSave
        }
      }
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: mocks.modalConfirm
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
        warning: mocks.toastWarning
      }
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.clipboardWriteText
      }
    })
  })

  it('shows an error and keeps multi-select mode when selected message export fails', async () => {
    mocks.fileSave.mockRejectedValueOnce(new Error('disk full'))

    const { result } = renderHook(() => useChatContextProvider({ id: 'topic-1' } as any))

    await act(async () => {
      await result.current.handleMultiSelectAction('save', ['m1'])
    })

    expect(mocks.fileSave).toHaveBeenCalledWith(
      expect.stringMatching(/^chat_export_.*\.md$/),
      'hello from selected message'
    )
    expect(mocks.toastError).toHaveBeenCalledWith('common.save_failed: disk full')
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setMultiSelectMode).not.toHaveBeenCalled()
    expect(mocks.setSelectedMessageIds).not.toHaveBeenCalled()
  })

  it('shows an error and keeps multi-select mode when selected message copy fails', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('permission denied'))

    const { result } = renderHook(() => useChatContextProvider({ id: 'topic-1' } as any))

    await act(async () => {
      await result.current.handleMultiSelectAction('copy', ['m1'])
    })

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('hello from selected message')
    expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: permission denied')
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.setMultiSelectMode).not.toHaveBeenCalled()
    expect(mocks.setSelectedMessageIds).not.toHaveBeenCalled()
  })

  it('prevents duplicate selected message delete confirmations and operations', async () => {
    const runningDelete = deferred<void>()
    mocks.deleteMessage.mockReturnValue(runningDelete.promise)

    const { result } = renderHook(() => useChatContextProvider({ id: 'topic-1' } as any))

    await act(async () => {
      await result.current.handleMultiSelectAction('delete', ['m1', 'm2'])
      await result.current.handleMultiSelectAction('delete', ['m1', 'm2'])
    })

    expect(mocks.modalConfirm).toHaveBeenCalledTimes(1)
    const options = mocks.modalConfirm.mock.calls[0][0]

    const firstDelete = options.onOk()
    const secondDelete = options.onOk()
    expect(mocks.deleteMessage).toHaveBeenCalledTimes(2)

    runningDelete.resolve(undefined)
    await Promise.all([firstDelete, secondDelete])

    expect(mocks.toastSuccess).toHaveBeenCalledWith('message.delete.success')
    expect(mocks.setMultiSelectMode).toHaveBeenCalledWith(false)
    expect(mocks.setSelectedMessageIds).toHaveBeenCalledWith([])
  })
})
