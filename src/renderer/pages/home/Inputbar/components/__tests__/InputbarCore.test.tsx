import '@testing-library/jest-dom/vitest'

import { TopicType } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import type { TextAreaRef } from 'antd/lib/input/TextArea'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InputbarToolsProvider } from '../../context/InputbarToolsProvider'
import { InputbarCore } from '../InputbarCore'

const cacheMock = vi.hoisted(() => ({
  values: new Map<string, unknown>()
}))

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
  const TextArea = ({
    ref,
    autoSize: _autoSize,
    styles: _styles,
    variant: _variant,
    ...props
  }: any & { ref?: React.RefObject<HTMLTextAreaElement | null> }) => <textarea ref={ref} {...props} />
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
  default: () => null
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
  default: {
    getLastFocusedComponent: vi.fn(),
    init: vi.fn(),
    registerHandler: vi.fn(),
    setLastFocusedComponent: vi.fn(),
    unregisterHandler: vi.fn()
  }
}))

function renderInputbar(scope: TopicType.Chat | TopicType.Session) {
  const textareaRef: React.RefObject<TextAreaRef | null> = { current: null }
  const actions = {
    resizeTextArea: vi.fn(),
    addNewTopic: vi.fn(),
    clearTopic: vi.fn(),
    onNewContext: vi.fn(),
    onTextChange: vi.fn(),
    toggleExpanded: vi.fn()
  }

  render(
    <InputbarToolsProvider initialState={{ files: [] }} actions={actions}>
      <InputbarCore
        scope={scope}
        placeholder="Say something"
        text="hello"
        onTextChange={vi.fn()}
        textareaRef={textareaRef}
        resizeTextArea={vi.fn()}
        focusTextarea={vi.fn()}
        height={undefined}
        onHeightChange={vi.fn()}
        supportedExts={[]}
        isLoading={false}
        handleSendMessage={vi.fn()}
      />
    </InputbarToolsProvider>
  )

  return {
    textarea: screen.getByRole('textbox'),
    sendButton: screen.getByRole('button', { name: 'send' })
  }
}

describe('InputbarCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.values.clear()
  })

  it('keeps the chat textarea editable when web search state is stale', () => {
    cacheMock.values.set('chat.web_search.searching', true)

    const { textarea, sendButton } = renderInputbar(TopicType.Chat)

    expect(textarea).not.toBeDisabled()
    expect(cacheMock.values.get('chat.web_search.searching')).toBe(false)
    expect(sendButton).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('does not let chat web-search state block agent session input', () => {
    cacheMock.values.set('chat.web_search.searching', true)

    const { textarea, sendButton } = renderInputbar(TopicType.Session)

    expect(textarea).not.toBeDisabled()
    expect(sendButton).not.toBeDisabled()
  })
})
