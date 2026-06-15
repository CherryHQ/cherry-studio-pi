import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatContextProvider } from '../useChatContext'

const mocks = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
  fileSave: vi.fn(),
  loggerError: vi.fn(),
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
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
        warning: mocks.toastWarning
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
})
