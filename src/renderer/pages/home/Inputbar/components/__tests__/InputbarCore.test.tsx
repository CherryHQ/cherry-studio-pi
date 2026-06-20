import '@testing-library/jest-dom/vitest'

import type { FileMetadata } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { TextAreaRef } from 'antd/lib/input/TextArea'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InputbarToolsProvider } from '../../context/InputbarToolsProvider'
import { InputbarCore } from '../InputbarCore'

const cacheMock = vi.hoisted(() => ({
  values: new Map<string, unknown>()
}))

const pasteServiceMock = vi.hoisted(() => ({
  getLastFocusedComponent: vi.fn(),
  init: vi.fn(),
  registerHandler: vi.fn(),
  setLastFocusedComponent: vi.fn(),
  unregisterHandler: vi.fn()
}))
const fileApiMock = vi.hoisted(() => ({
  readExternal: vi.fn()
}))
const clipboardWriteTextMock = vi.hoisted(() => vi.fn())

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

vi.mock('@ant-design/icons', async () => {
  const React = await import('react')
  return {
    HolderOutlined: () => React.createElement('span', { 'data-testid': 'drag-handle-icon' })
  }
})

vi.mock('antd', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('antd/es/input/TextArea', () => {
  const TextArea = ({ ref, ...props }: any & { ref?: React.RefObject<HTMLTextAreaElement | null> }) => {
    const textareaProps = { ...props }
    delete textareaProps.autoSize
    delete textareaProps.styles
    delete textareaProps.variant
    return <textarea ref={ref} {...textareaProps} />
  }
  TextArea.displayName = 'MockTextArea'

  return { default: TextArea }
})

vi.mock('@data/hooks/useCache', () => ({
  useCache: (key: string) => {
    const value = cacheMock.values.has(key) ? cacheMock.values.get(key) : false
    const setValue = (nextValue: unknown) => {
      cacheMock.values.set(key, nextValue)
    }

    return [value, setValue]
  }
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}))

vi.mock('@renderer/components/QuickPanel', async () => {
  const React = await import('react')
  const close = vi.fn()
  const open = vi.fn()

  return {
    QuickPanelReservedSymbol: {
      Root: '/',
      MentionModels: '@'
    },
    QuickPanelView: () => React.createElement('div', { 'data-testid': 'quick-panel' }),
    QuickPanelProvider: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
    useQuickPanel: () => ({
      close,
      open,
      isVisible: false,
      lastCloseAction: undefined,
      multiple: false,
      symbol: undefined,
      triggerInfo: undefined
    })
  }
})

vi.mock('@renderer/components/TranslateButton', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" aria-label="translate" disabled={disabled}>
      translate
    </button>
  )
}))

vi.mock('@renderer/hooks/translate', () => ({
  useTranslate: () => ({
    translate: vi.fn().mockResolvedValue(''),
    isTranslating: false
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, callback: () => void) => {
      callback()
    }
  })
}))

vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/pages/home/Inputbar/SendMessageButton', () => ({
  default: ({ disabled, sendMessage }: { disabled?: boolean; sendMessage: () => void }) => (
    <button type="button" aria-label="send" disabled={disabled} onClick={sendMessage}>
      send
    </button>
  )
}))

vi.mock('@renderer/pages/home/Inputbar/AttachmentPreview', () => ({
  default: ({ files, onPasteAsText }: { files: FileMetadata[]; onPasteAsText: (file: FileMetadata) => void }) => (
    <div>
      {files.map((file) => (
        <button key={file.id} type="button" aria-label={`paste ${file.name}`} onClick={() => onPasteAsText(file)}>
          paste
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/pages/home/Inputbar/hooks/useFileDragDrop', () => ({
  useFileDragDrop: () => ({
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    isDragging: false
  })
}))

vi.mock('@renderer/pages/home/Inputbar/hooks/usePasteHandler', () => ({
  usePasteHandler: () => ({
    handlePaste: vi.fn()
  })
}))

vi.mock('@renderer/services/PasteService', () => ({
  default: pasteServiceMock
}))

function renderInputbar(
  scope: TopicType.Chat | TopicType.Session,
  overrides: {
    files?: FileMetadata[]
    focusTextarea?: () => void
    onHeightChange?: (height: number) => void
    onTextChange?: (text: string) => void
  } = {}
) {
  const textareaRef: React.RefObject<TextAreaRef | null> = { current: null }
  const focusTextarea = overrides.focusTextarea ?? vi.fn()
  const onHeightChange = overrides.onHeightChange ?? vi.fn()
  const onTextChange = overrides.onTextChange ?? vi.fn()
  const actions = {
    resizeTextArea: vi.fn(),
    addNewTopic: vi.fn(),
    clearTopic: vi.fn(),
    onNewContext: vi.fn(),
    onTextChange: vi.fn(),
    toggleExpanded: vi.fn()
  }

  const view = render(
    <InputbarToolsProvider initialState={{ files: overrides.files ?? [] }} actions={actions}>
      <InputbarCore
        scope={scope}
        placeholder="Say something"
        text="hello"
        onTextChange={onTextChange}
        textareaRef={textareaRef}
        resizeTextArea={vi.fn()}
        focusTextarea={focusTextarea}
        height={undefined}
        onHeightChange={onHeightChange}
        supportedExts={[]}
        isLoading={false}
        handleSendMessage={vi.fn()}
      />
    </InputbarToolsProvider>
  )

  return {
    textarea: screen.getByRole('textbox'),
    sendButton: screen.getByRole('button', { name: 'send' }),
    focusTextarea,
    onHeightChange,
    onTextChange,
    unmount: view.unmount
  }
}

describe('InputbarCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.values.clear()
    pasteServiceMock.getLastFocusedComponent.mockReturnValue('inputbar')
    fileApiMock.readExternal.mockReset()
    fileApiMock.readExternal.mockResolvedValue('file content')
    clipboardWriteTextMock.mockReset()
    clipboardWriteTextMock.mockResolvedValue(undefined)
    Object.assign(window, {
      api: {
        file: fileApiMock
      }
    })
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock
      }
    })
  })

  it('keeps the chat textarea editable when web search state is stale', () => {
    cacheMock.values.set('chat.web_search.searching', true)

    const { textarea, sendButton } = renderInputbar(TopicType.Chat)

    expect(textarea).not.toBeDisabled()
    expect(cacheMock.values.get('chat.web_search.searching')).toBe(false)
    expect(sendButton).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('ignores delayed txt attachment paste after unmount', async () => {
    const readOperation = deferred<string>()
    fileApiMock.readExternal.mockReturnValueOnce(readOperation.promise)
    const onTextChange = vi.fn()
    const file = {
      id: 'file-1',
      name: 'notes.txt',
      path: '/tmp/notes.txt'
    } as FileMetadata
    const { unmount } = renderInputbar(TopicType.Chat, { files: [file], onTextChange })

    fireEvent.click(screen.getByRole('button', { name: 'paste notes.txt' }))
    expect(fileApiMock.readExternal).toHaveBeenCalledWith('/tmp/notes.txt', true)
    unmount()

    await act(async () => {
      readOperation.resolve('delayed content')
      await readOperation.promise
    })

    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
    expect(onTextChange).not.toHaveBeenCalled()
  })

  it('does not let chat web-search state block agent session input', () => {
    cacheMock.values.set('chat.web_search.searching', true)

    const { textarea, sendButton } = renderInputbar(TopicType.Session)

    expect(textarea).not.toBeDisabled()
    expect(sendButton).not.toBeDisabled()
  })

  it('does not steal focus from an active selector input when the window refocuses', () => {
    const focusTextarea = vi.fn()
    renderInputbar(TopicType.Chat, { focusTextarea })
    const selectorInput = document.createElement('input')
    document.body.append(selectorInput)

    try {
      selectorInput.focus()
      window.dispatchEvent(new Event('focus'))

      expect(focusTextarea).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(selectorInput)
    } finally {
      selectorInput.remove()
    }
  })

  it('removes resize drag listeners when unmounted during a drag', () => {
    const onHeightChange = vi.fn()
    const { unmount } = renderInputbar(TopicType.Chat, { onHeightChange })
    const dragHandle = screen.getByTestId('drag-handle-icon').parentElement
    expect(dragHandle).toBeTruthy()

    fireEvent.mouseDown(dragHandle!, { clientY: 120 })
    fireEvent.mouseMove(document, { clientY: 80 })

    expect(onHeightChange).toHaveBeenCalledTimes(1)

    onHeightChange.mockClear()
    unmount()
    fireEvent.mouseMove(document, { clientY: 40 })

    expect(onHeightChange).not.toHaveBeenCalled()
  })
})
