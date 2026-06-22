import type { Topic } from '@renderer/types'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelAnimationFrame: vi.fn(),
  captureScrollableAsBlob: vi.fn(),
  chatVirtualListProps: null as null | { onReachTop?: () => void },
  clearTopicMessages: vi.fn(),
  clipboardWrite: vi.fn(),
  clipboardWriteText: vi.fn(),
  getGroupedMessages: vi.fn(() => ({})),
  requestAnimationFrame: vi.fn(() => 42),
  setTimeoutTimer: vi.fn(),
  modalConfirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  usePreference: vi.fn((key: string) => [key === 'chat.message.navigation_mode' ? 'none' : false]),
  eventUnsubscribe: vi.fn(),
  eventOn: vi.fn(() => vi.fn()),
  useCommandHandler: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    patch: vi.fn()
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: mocks.usePreference
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div data-testid="loading-icon" />
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: mocks.useCommandHandler
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: null })
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContext: () => ({
    handleSelectMessage: vi.fn(),
    isMultiSelectMode: false
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/hooks/V2ChatContext', () => ({
  useV2Chat: () => ({
    clearTopicMessages: mocks.clearTopicMessages
  })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    CLEAR_MESSAGES: 'clear-messages',
    COPY_TOPIC_IMAGE: 'copy-topic-image',
    EDIT_CODE_BLOCK: 'edit-code-block',
    EDIT_MESSAGE: 'edit-message',
    EXPORT_TOPIC_IMAGE: 'export-topic-image',
    NEW_CONTEXT: 'new-context',
    SEND_MESSAGE: 'send-message'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: mocks.eventOn
  }
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getGroupedMessages: mocks.getGroupedMessages
}))

vi.mock('@renderer/utils', () => ({
  captureScrollableAsBlob: mocks.captureScrollableAsBlob,
  captureScrollableAsDataURL: vi.fn(),
  removeSpecialCharactersForFileName: (value: string) => value
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('@renderer/utils/markdown', () => ({
  updateCodeBlock: vi.fn()
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: vi.fn(() => '')
}))

vi.mock('@renderer/utils/messageUtils/partsHelpers', () => ({
  getTextFromParts: vi.fn(() => '')
}))

vi.mock('../Blocks', () => ({
  resolvePartFromParts: vi.fn(),
  usePartsMap: () => ({})
}))

vi.mock('../ChatVirtualList', () => ({
  ChatVirtualList: (props: { handleRef: React.MutableRefObject<any>; onReachTop?: () => void }) => {
    const { handleRef } = props
    mocks.chatVirtualListProps = props
    handleRef.current = {
      getScrollElement: () => document.createElement('div'),
      scrollToBottom: vi.fn(),
      scrollToKey: vi.fn()
    }
    return <div data-testid="chat-virtual-list" />
  }
}))

vi.mock('../MessageAnchorLine', () => ({
  default: () => <div data-testid="message-anchor-line" />
}))

vi.mock('../MessageGroup', () => ({
  default: () => <div data-testid="message-group" />
}))

vi.mock('../NarrowLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../Prompt', () => ({
  default: () => <div data-testid="prompt" />
}))

vi.mock('../SelectionBox', () => ({
  default: () => <div data-testid="selection-box" />
}))

vi.mock('../shared', () => ({
  MessagesContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const { default: Messages } = await import('../Messages')

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chatVirtualListProps = null
    mocks.setTimeoutTimer.mockImplementation((_key: string, fn: () => void) => {
      fn()
      return vi.fn()
    })
    vi.stubGlobal('requestAnimationFrame', mocks.requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', mocks.cancelAnimationFrame)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: mocks.clipboardWrite,
        writeText: mocks.clipboardWriteText
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess
      }
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: mocks.modalConfirm
      }
    })
    vi.stubGlobal(
      'ClipboardItem',
      vi.fn((items) => ({ items }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels the component update frame on unmount', () => {
    const onComponentUpdate = vi.fn()
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic

    const { unmount } = render(<Messages topic={topic} messages={[]} onComponentUpdate={onComponentUpdate} />)

    expect(mocks.requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onComponentUpdate).not.toHaveBeenCalled()

    unmount()

    expect(mocks.cancelAnimationFrame).toHaveBeenCalledWith(42)
    expect(onComponentUpdate).not.toHaveBeenCalled()
  })

  it('shows an error when the copy-last-message command cannot write to clipboard', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic
    render(
      <Messages
        topic={topic}
        messages={[{ id: 'message-1', role: 'assistant', topicId: topic.id } as any]}
        onComponentUpdate={vi.fn()}
      />
    )

    const commandHandler = mocks.useCommandHandler.mock.calls.find(
      ([command]) => command === 'chat.message.copy_last'
    )?.[1]

    await commandHandler?.()

    expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: clipboard unavailable')
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('message.copy.success')
  })

  it('ignores copy-last-message failures after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.clipboardWriteText.mockReturnValueOnce(clipboardOperation.promise)
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic
    const { unmount } = render(
      <Messages
        topic={topic}
        messages={[{ id: 'message-1', role: 'assistant', topicId: topic.id } as any]}
        onComponentUpdate={vi.fn()}
      />
    )

    const commandHandler = mocks.useCommandHandler.mock.calls.find(
      ([command]) => command === 'chat.message.copy_last'
    )?.[1]

    const action = commandHandler?.()
    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.reject(new Error('clipboard unavailable after unmount'))
      await action
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('message.copy.success')
  })

  it('shows an error when copying the topic image cannot write to clipboard', async () => {
    mocks.captureScrollableAsBlob.mockImplementationOnce(async (_ref, callback) => {
      await callback(new Blob(['image'], { type: 'image/png' }))
    })
    mocks.clipboardWrite.mockRejectedValueOnce(new Error('image clipboard unavailable'))
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic

    render(<Messages topic={topic} messages={[]} onComponentUpdate={vi.fn()} />)

    const eventCalls = mocks.eventOn.mock.calls as unknown as Array<[string, (...args: unknown[]) => unknown]>
    const eventHandler = eventCalls.find(([eventName]) => eventName === 'copy-topic-image')?.[1]

    await eventHandler?.(topic)

    expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: image clipboard unavailable')
    expect(mocks.clipboardWrite).toHaveBeenCalled()
  })

  it('ignores topic image copy failures after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.captureScrollableAsBlob.mockImplementationOnce(async (_ref, callback) => {
      await callback(new Blob(['image'], { type: 'image/png' }))
    })
    mocks.clipboardWrite.mockReturnValueOnce(clipboardOperation.promise)
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic

    const { unmount } = render(<Messages topic={topic} messages={[]} onComponentUpdate={vi.fn()} />)

    const eventCalls = mocks.eventOn.mock.calls as unknown as Array<[string, (...args: unknown[]) => unknown]>
    const eventHandler = eventCalls.find(([eventName]) => eventName === 'copy-topic-image')?.[1]

    const action = eventHandler?.(topic)
    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.reject(new Error('image clipboard unavailable after unmount'))
      await action
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('prevents duplicate clear-topic confirmations and operations', async () => {
    const runningClear = deferred<void>()
    mocks.clearTopicMessages.mockReturnValue(runningClear.promise)
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic

    render(<Messages topic={topic} messages={[]} onComponentUpdate={vi.fn()} />)

    const eventCalls = mocks.eventOn.mock.calls as unknown as Array<[string, (...args: unknown[]) => unknown]>
    const eventHandler = eventCalls.find(([eventName]) => eventName === 'clear-messages')?.[1]

    await eventHandler?.(topic)
    await eventHandler?.(topic)

    expect(mocks.modalConfirm).toHaveBeenCalledTimes(1)
    const options = mocks.modalConfirm.mock.calls[0][0]

    const firstClear = options.onOk()
    const secondClear = options.onOk()
    expect(mocks.clearTopicMessages).toHaveBeenCalledTimes(1)

    runningClear.resolve(undefined)
    await Promise.all([firstClear, secondClear])
  })

  it('keeps the older-message loader busy until async pagination settles', async () => {
    const pagination = deferred<void>()
    const loadOlder = vi.fn(() => pagination.promise)
    const topic = { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic' } as Topic

    render(<Messages topic={topic} messages={[]} hasOlder loadOlder={loadOlder} onComponentUpdate={vi.fn()} />)

    act(() => {
      mocks.chatVirtualListProps?.onReachTop?.()
    })

    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalledWith('loadMoreMessages', expect.any(Function), expect.any(Number))

    await act(async () => {
      pagination.resolve()
      await pagination.promise
    })

    await waitFor(() =>
      expect(mocks.setTimeoutTimer).toHaveBeenCalledWith('loadMoreMessages', expect.any(Function), expect.any(Number))
    )
  })
})
