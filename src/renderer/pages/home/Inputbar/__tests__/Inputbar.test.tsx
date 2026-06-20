import '@testing-library/jest-dom/vitest'

import { TopicType } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Inputbar from '../Inputbar'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const {
  assistantMock,
  cacheServiceMock,
  createTopicMock,
  emptyKnowledgeBases,
  focusTextareaMock,
  modelMock,
  resizeTextAreaMock,
  topicStreamStatus,
  updateAssistantMock
} = vi.hoisted(() => ({
  assistantMock: {
    id: 'assistant-1',
    knowledgeBaseIds: [],
    settings: {
      enableWebSearch: false
    }
  },
  cacheServiceMock: {
    getCasual: vi.fn(),
    setCasual: vi.fn()
  },
  createTopicMock: vi.fn(),
  emptyKnowledgeBases: [],
  focusTextareaMock: vi.fn(),
  modelMock: {
    id: 'openai::gpt-4.1',
    providerId: 'openai',
    name: 'GPT 4.1',
    capabilities: []
  },
  resizeTextAreaMock: vi.fn(),
  topicStreamStatus: {
    isPending: false
  },
  updateAssistantMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@data/CacheService', () => ({
  cacheService: cacheServiceMock
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.input.quick_panel.triggers_enabled') return [true, vi.fn()]
    if (key === 'chat.input.send_message_shortcut') return ['Enter', vi.fn()]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@renderer/config/models', () => ({
  isGenerateImageModel: () => false,
  isGenerateImageModels: () => false,
  isVisionModel: () => false,
  isVisionModels: () => false
}))

vi.mock('@renderer/types', () => ({
  FILE_TYPE: {
    IMAGE: 'image'
  },
  TopicType: {
    Chat: 'chat',
    Session: 'session'
  }
}))

vi.mock('@renderer/utils', () => ({
  delay: () => Promise.resolve()
}))

vi.mock('@renderer/utils/input', () => ({
  getSendMessageShortcutLabel: () => 'Enter'
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false, vi.fn()]
}))

vi.mock('@renderer/features/command', () => ({
  useCommandHandler: vi.fn()
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: assistantMock,
    model: modelMock,
    updateAssistant: updateAssistantMock
  })
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({
    bases: emptyKnowledgeBases
  })
}))

vi.mock('@renderer/hooks/useSaveFailedToast', () => ({
  useSaveFailedToast: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTextareaResize', () => ({
  useTextareaResize: () => ({
    textareaRef: { current: null },
    resize: resizeTextAreaMock,
    focus: focusTextareaMock,
    setExpanded: vi.fn(),
    isExpanded: false,
    customHeight: undefined,
    setCustomHeight: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, callback: () => void) => callback()
  })
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic,
  useTopicMutations: () => ({
    createTopic: createTopicMock
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicAwaitingApproval: () => false,
  useTopicStreamStatus: () => topicStreamStatus
}))

vi.mock('@renderer/hooks/V2ChatContext', () => ({
  useV2Chat: () => ({
    pause: vi.fn()
  })
}))

vi.mock('@renderer/pages/home/Inputbar/components/InputbarCore', () => ({
  InputbarCore: ({ handleSendMessage, text }: { handleSendMessage: () => void; text: string }) => (
    <>
      <div data-testid="inputbar-text">{text}</div>
      <button type="button" data-testid="inputbar-send" onClick={handleSendMessage}>
        send
      </button>
    </>
  )
}))

vi.mock('@renderer/pages/home/Inputbar/InputbarTools', () => ({
  default: () => null
}))

vi.mock('@renderer/pages/home/Inputbar/KnowledgeBaseInput', () => ({
  default: () => null
}))

vi.mock('@renderer/pages/home/Inputbar/MentionModelsInput', () => ({
  default: () => null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    ADD_NEW_TOPIC: 'ADD_NEW_TOPIC',
    NEW_CONTEXT: 'NEW_CONTEXT',
    SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  }
}))

describe('Inputbar', () => {
  beforeEach(() => {
    cacheServiceMock.getCasual.mockReset()
    cacheServiceMock.setCasual.mockReset()
    createTopicMock.mockReset()
    focusTextareaMock.mockReset()
    resizeTextAreaMock.mockReset()
    updateAssistantMock.mockReset()
    topicStreamStatus.isPending = false
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('ignores duplicate sends while the previous send is still in flight', async () => {
    cacheServiceMock.getCasual.mockReturnValue('hello')
    const sendDeferred = createDeferred<void>()
    const onSend = vi.fn().mockReturnValue(sendDeferred.promise)

    render(
      <Inputbar
        topic={{
          id: 'topic-1',
          assistantId: 'assistant-1',
          name: 'Topic 1',
          type: TopicType.Chat,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messages: []
        }}
        setActiveTopic={vi.fn()}
        onSend={onSend}
      />
    )

    fireEvent.click(screen.getByTestId('inputbar-send'))
    fireEvent.click(screen.getByTestId('inputbar-send'))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello', {
      files: undefined,
      mentionedModels: undefined
    })

    sendDeferred.resolve()
    await waitFor(() => expect(screen.getByTestId('inputbar-text')).toHaveTextContent(''))
  })
})
