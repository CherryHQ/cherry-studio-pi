import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStorageV2AutoHydrateEnabled: vi.fn(),
  listStorageV2Conversations: vi.fn(),
  listStorageV2Messages: vi.fn(),
  topicsGet: vi.fn(),
  topicsPut: vi.fn(),
  messageBlocksBulkPut: vi.fn(),
  messageBlocksBulkDelete: vi.fn(),
  filesBulkPut: vi.fn(),
  transaction: vi.fn(async (...args: unknown[]) => {
    const callback = args.at(-1)
    if (typeof callback === 'function') {
      await callback()
    }
  })
}))

vi.mock('../StorageV2HydrationService', () => ({
  getStorageV2AutoHydrateEnabled: mocks.getStorageV2AutoHydrateEnabled
}))

vi.mock('../StorageV2Service', () => ({
  listStorageV2Conversations: mocks.listStorageV2Conversations,
  listStorageV2Messages: mocks.listStorageV2Messages
}))

vi.mock('@renderer/databases', () => ({
  default: {
    topics: {
      get: mocks.topicsGet,
      put: mocks.topicsPut
    },
    message_blocks: {
      bulkPut: mocks.messageBlocksBulkPut,
      bulkDelete: mocks.messageBlocksBulkDelete
    },
    files: {
      bulkPut: mocks.filesBulkPut
    },
    transaction: mocks.transaction
  }
}))

import {
  fetchStorageV2TopicMessages,
  shouldPreferStorageV2ConversationReads
} from '../StorageV2ConversationHydrationService'

describe('StorageV2ConversationHydrationService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    originalApi = window.api
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getAppInfo: vi.fn().mockResolvedValue({
          filesPath: '/tmp/cherry-files'
        })
      }
    })
    mocks.topicsGet.mockResolvedValue({
      id: 'topic-1',
      messages: [
        {
          id: 'old-message',
          blocks: ['old-block', 'block-text']
        }
      ]
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('hydrates Storage v2 messages into runtime messages and seeds Dexie cache', async () => {
    mocks.listStorageV2Conversations.mockResolvedValue([{ id: 'topic-1', ownerId: 'assistant-1' }])
    mocks.listStorageV2Messages.mockResolvedValueOnce([
      {
        id: 'message-1',
        role: 'user',
        status: null,
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
        blocks: [
          {
            id: 'block-file',
            messageId: 'message-1',
            type: 'file',
            ordinal: 2,
            text: null,
            payload: {
              file: {
                id: 'file-1',
                name: '',
                origin_name: 'upload.txt',
                ext: 'txt',
                path: '/old/path/upload.txt',
                count: 0
              }
            },
            createdAt: '2026-01-01T00:00:02.000Z',
            updatedAt: null
          },
          {
            id: 'block-text',
            messageId: 'message-1',
            type: 'main_text',
            ordinal: 1,
            text: 'hello from Storage v2',
            payload: null,
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: null
          }
        ]
      }
    ])

    const result = await fetchStorageV2TopicMessages('topic-1')

    expect(result?.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: 'success',
        blocks: ['block-text', 'block-file']
      })
    ])
    expect(result?.blocks).toEqual([
      expect.objectContaining({
        id: 'block-file',
        type: 'file',
        status: 'success',
        file: expect.objectContaining({
          id: 'file-1',
          name: 'file-1.txt',
          origin_name: 'upload.txt',
          ext: '.txt',
          path: '/tmp/cherry-files/file-1.txt',
          count: 1
        })
      }),
      expect.objectContaining({
        id: 'block-text',
        type: 'main_text',
        status: 'success',
        content: 'hello from Storage v2'
      })
    ])
    expect(mocks.transaction).toHaveBeenCalled()
    expect(mocks.messageBlocksBulkDelete).toHaveBeenCalledWith(['old-block'])
    expect(mocks.messageBlocksBulkPut).toHaveBeenCalledWith(result?.blocks)
    expect(mocks.filesBulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'file-1',
        path: '/tmp/cherry-files/file-1.txt'
      })
    ])
    expect(mocks.topicsPut).toHaveBeenCalledWith({
      id: 'topic-1',
      messages: result?.messages
    })
  })

  it('does not seed Dexie when Storage v2 has no topic messages', async () => {
    mocks.listStorageV2Messages.mockResolvedValueOnce([])

    await expect(fetchStorageV2TopicMessages('empty-topic')).resolves.toBeNull()

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.listStorageV2Conversations).not.toHaveBeenCalled()
  })

  it('falls back to legacy reads when Storage v2 auto hydrate status cannot be read', async () => {
    mocks.getStorageV2AutoHydrateEnabled.mockRejectedValueOnce(new Error('ipc unavailable'))

    await expect(shouldPreferStorageV2ConversationReads()).resolves.toBe(false)
  })
})
