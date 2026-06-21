import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HomeWindow from '../HomeWindow'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetTemporaryTopic: vi.fn(),
  resetExecutionMessages: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: mocks.sendMessage,
    stop: mocks.stopChat,
    setMessages: mocks.setMessages
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'feature.quick_assistant.read_clipboard_at_startup': false,
      'feature.quick_assistant.assistant_id': null,
      'app.language': 'en-us',
      'ui.window_style': 'opaque'
    }
    return [values[key]]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: null,
    model: null
  }),
  useDefaultAssistant: () => ({
    assistant: {
      id: 'default-assistant',
      name: 'Default Assistant'
    }
  })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    liveAssistants: [
      {
        id: 'assistant-message',
        role: 'assistant',
        parts: []
      }
    ],
    reset: mocks.resetExecutionMessages
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({
    defaultModel: {
      id: 'model-1',
      name: 'Model One'
    }
  })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: 'topic-1',
    ready: true,
    reset: mocks.resetTemporaryTopic
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    activeExecutions: [],
    isPending: false
  })
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    changeLanguage: vi.fn()
  }
}))

vi.mock('@renderer/transport/IpcChatTransport', () => ({
  ipcChatTransport: {}
}))

vi.mock('@renderer/utils/messageUtils/partsHelpers', () => ({
  getTextFromParts: () => 'assistant output'
}))

vi.mock('antd', () => ({
  Divider: (props: React.HTMLAttributes<HTMLHRElement>) => <hr {...props} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../components/ClipboardPreview', () => ({
  default: () => <div data-testid="clipboard-preview" />
}))

vi.mock('../components/FeatureMenus', async () => {
  const ReactModule = (await vi.importActual('react')) as typeof React
  return {
    default: ReactModule.forwardRef(
      ({ setRoute }: { setRoute: (route: 'chat') => void }, ref: React.ForwardedRef<unknown>) => {
        ReactModule.useImperativeHandle(ref, () => ({
          resetSelectedIndex: vi.fn(),
          useFeature: vi.fn()
        }))
        return (
          <button type="button" onClick={() => setRoute('chat')}>
            open chat
          </button>
        )
      }
    )
  }
})

vi.mock('../components/Footer', () => ({
  default: ({ onCopy }: { onCopy?: () => void }) =>
    onCopy ? (
      <button type="button" onClick={onCopy}>
        copy last message
      </button>
    ) : (
      <div data-testid="quick-assistant-footer" />
    )
}))

vi.mock('../components/InputBar', async () => {
  const ReactModule = (await vi.importActual('react')) as typeof React
  return {
    default: ReactModule.forwardRef((_props: Record<string, unknown>, ref: React.ForwardedRef<HTMLDivElement>) => (
      <div ref={ref} data-testid="input-bar" />
    ))
  }
})

vi.mock('../../chat/ChatWindow', () => ({
  default: () => <div data-testid="chat-window" />
}))

vi.mock('../../translate/TranslateWindow', () => ({
  default: () => <div data-testid="translate-window" />
}))

function renderChatRoute() {
  render(<HomeWindow draggable={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'open chat' }))
}

describe('HomeWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        quickAssistant: {
          hide: vi.fn(),
          setPin: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: vi.fn(() => vi.fn())
        }
      }
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.writeText
      }
    })
  })

  it('does not crash after a successful copy before toast is available', async () => {
    mocks.writeText.mockResolvedValue(undefined)
    renderChatRoute()

    fireEvent.click(screen.getByRole('button', { name: 'copy last message' }))

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith('assistant output')
    })
  })

  it('does not crash after a failed copy before toast is available', async () => {
    mocks.writeText.mockRejectedValue(new Error('clipboard denied'))
    renderChatRoute()

    fireEvent.click(screen.getByRole('button', { name: 'copy last message' }))

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith('assistant output')
    })
  })
})
