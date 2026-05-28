import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  filesGet: vi.fn(),
  fetchStorageV2TopicMessages: vi.fn(),
  messageBlocksAnyOf: vi.fn(),
  messageBlocksWhere: vi.fn(),
  topicsGet: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      get: mocks.filesGet
    },
    message_blocks: {
      where: mocks.messageBlocksWhere
    },
    topics: {
      get: mocks.topicsGet
    }
  }
}))

vi.mock('../StorageV2ConversationHydrationService', () => ({
  fetchStorageV2TopicMessages: mocks.fetchStorageV2TopicMessages
}))

describe('StorageV2ConversationMirrorService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
    mocks.fetchStorageV2TopicMessages.mockResolvedValue(null)
    mocks.messageBlocksAnyOf.mockResolvedValue([])
    mocks.messageBlocksWhere.mockReturnValue({ anyOf: mocks.messageBlocksAnyOf })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('flushes empty topic metadata with assistant topic order', async () => {
    const syncConversation = vi.fn().mockResolvedValue({ messageCount: 0, blockCount: 0 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          syncConversation
        }
      }
    })

    mocks.topicsGet.mockResolvedValue({
      id: 'topic-2',
      messages: []
    })

    const state = {
      assistants: {
        assistants: [
          {
            id: 'assistant-1',
            topics: [
              {
                id: 'topic-1',
                assistantId: 'assistant-1',
                name: 'First',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                messages: []
              },
              {
                id: 'topic-2',
                assistantId: 'assistant-1',
                name: 'Second',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:01.000Z',
                messages: [],
                pinned: true
              }
            ]
          }
        ]
      }
    }

    const { storageV2ConversationMirrorService } = await import('../StorageV2ConversationMirrorService')

    await storageV2ConversationMirrorService.flushTopic('topic-2', () => state)

    expect(syncConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'topic-2',
        messages: [],
        blocks: []
      }),
      {
        pruneMissingBlocks: false,
        pruneMissingMessages: false
      }
    )
    expect(mocks.fetchStorageV2TopicMessages).toHaveBeenCalledWith('topic-2')
    expect(syncConversation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'topic-2',
        ownerId: 'assistant-1',
        title: 'Second',
        pinned: true,
        sortOrder: 1,
        messages: [],
        blocks: []
      })
    )
  })

  it('skips pre-hydration for destructive topic flushes', async () => {
    const syncConversation = vi.fn().mockResolvedValue({ messageCount: 0, blockCount: 0 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          syncConversation
        }
      }
    })

    mocks.topicsGet.mockResolvedValue({
      id: 'topic-1',
      messages: []
    })

    const state = {
      assistants: {
        assistants: [
          {
            id: 'assistant-1',
            topics: [
              {
                id: 'topic-1',
                assistantId: 'assistant-1',
                name: 'Cleared',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                messages: []
              }
            ]
          }
        ]
      }
    }

    const { storageV2ConversationMirrorService } = await import('../StorageV2ConversationMirrorService')

    await storageV2ConversationMirrorService.flushTopic('topic-1', () => state, { destructive: true })

    expect(mocks.fetchStorageV2TopicMessages).not.toHaveBeenCalled()
    expect(syncConversation).toHaveBeenCalledTimes(1)
    expect(syncConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'topic-1',
        messages: [],
        blocks: []
      })
    )
  })
})
