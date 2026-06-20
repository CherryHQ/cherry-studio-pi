import '@testing-library/jest-dom/vitest'

import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SearchMessage from '../SearchMessage'

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

const getTopicByIdMock = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  RowFlex: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/context/MessageEditingContext', () => ({
  MessageEditingProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicById: getTopicByIdMock
}))

vi.mock('@renderer/pages/home/Messages/Message', () => ({
  default: ({ message, topic }: { message: Message; topic: Topic }) => (
    <div data-testid="message-item">
      {message.id}:{topic.name}
    </div>
  )
}))

vi.mock('@renderer/services/MessagesService', () => ({
  locateToMessage: vi.fn()
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    navigate: vi.fn()
  }
}))

vi.mock('@renderer/utils', () => ({
  runAsyncFunction: (fn: () => Promise<void>) => fn()
}))

vi.mock('lucide-react', () => ({
  Forward: () => <span data-testid="forward-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const topic = (id: string, name: string): Topic =>
  ({
    id,
    name,
    messages: []
  }) as Topic

const message = (id: string, topicId: string): Message =>
  ({
    id,
    topicId,
    role: 'user',
    content: id
  }) as Message

describe('SearchMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores stale topic loads when the selected message changes', async () => {
    const firstTopic = deferred<Topic>()
    const secondTopic = deferred<Topic>()
    getTopicByIdMock.mockReturnValueOnce(firstTopic.promise).mockReturnValueOnce(secondTopic.promise)

    const { rerender } = render(<SearchMessage message={message('message-1', 'topic-1')} />)
    rerender(<SearchMessage message={message('message-2', 'topic-2')} />)

    await act(async () => {
      secondTopic.resolve(topic('topic-2', 'Topic Two'))
      await secondTopic.promise
    })

    await waitFor(() => {
      expect(screen.getByTestId('message-item')).toHaveTextContent('message-2:Topic Two')
    })

    await act(async () => {
      firstTopic.resolve(topic('topic-1', 'Topic One'))
      await firstTopic.promise
    })

    expect(screen.getByTestId('message-item')).toHaveTextContent('message-2:Topic Two')
    expect(screen.queryByText('message-1:Topic One')).not.toBeInTheDocument()
  })
})
