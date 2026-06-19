import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicContent from '../TopicContent'

const mocks = vi.hoisted(() => ({
  setModel: vi.fn(),
  updateTopic: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: () => <span data-testid="emoji-icon" />
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: React.ReactNode }) => <div>{trigger}</div>
}))

vi.mock('@renderer/components/ResourceSelector', () => ({
  AssistantSelector: ({ onChange, trigger }: { onChange: (id: string | null) => void; trigger: React.ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('assistant-2')}>
        assistant-selector
      </button>
    </div>
  )
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
      id: 'assistant-1',
      name: 'Assistant One',
      emoji: 'A',
      settings: {
        enableWebSearch: false
      }
    },
    model: {
      id: 'model-1',
      name: 'Model One',
      providerId: 'provider-1'
    },
    setModel: mocks.setModel
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Provider One'
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({
    updateTopic: mocks.updateTopic
  })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils', () => ({
  getLeadingEmoji: () => 'A'
}))

vi.mock('@shared/utils/model', () => ({
  isNonChatModel: () => false,
  isWebSearchModel: () => false
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span />
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

vi.mock('../../Tools', () => ({
  default: () => <div data-testid="tools" />
}))

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe('TopicContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setModel.mockResolvedValue(undefined)
    mocks.updateTopic.mockResolvedValue(undefined)
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  it('ignores stale assistant switch failures after unmount', async () => {
    const pendingUpdate = deferred<void>()
    mocks.updateTopic.mockReturnValueOnce(pendingUpdate.promise)

    const { unmount } = render(<TopicContent assistantId="assistant-1" topicId="topic-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'assistant-selector' }))
    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-1', { assistantId: 'assistant-2' })
    unmount()

    await act(async () => {
      pendingUpdate.reject(new Error('save failed after unmount'))
      await pendingUpdate.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
