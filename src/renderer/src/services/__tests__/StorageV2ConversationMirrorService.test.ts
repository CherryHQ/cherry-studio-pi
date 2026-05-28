import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  filesGet: vi.fn(),
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

describe('StorageV2ConversationMirrorService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
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

    expect(syncConversation).toHaveBeenCalledWith(
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
})
