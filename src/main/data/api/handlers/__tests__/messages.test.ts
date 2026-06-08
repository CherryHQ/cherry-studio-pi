import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getTreeMock,
  getBranchMessagesMock,
  createMessageMock,
  getPathThroughMock,
  getByIdMock,
  updateMessageMock,
  deleteMessageMock,
  createSiblingMock
} = vi.hoisted(() => ({
  getTreeMock: vi.fn(),
  getBranchMessagesMock: vi.fn(),
  createMessageMock: vi.fn(),
  getPathThroughMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMessageMock: vi.fn(),
  deleteMessageMock: vi.fn(),
  createSiblingMock: vi.fn()
}))

vi.mock('@data/services/MessageService', () => ({
  messageService: {
    getTree: getTreeMock,
    getBranchMessages: getBranchMessagesMock,
    create: createMessageMock,
    getPathThrough: getPathThroughMock,
    getById: getByIdMock,
    update: updateMessageMock,
    delete: deleteMessageMock,
    createSibling: createSiblingMock
  }
}))

import { BRANCH_MESSAGES_MAX_LIMIT, MESSAGE_TREE_MAX_DEPTH } from '@shared/data/api/schemas/messages'

import { messageHandlers } from '../messages'

describe('messageHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('coerces numeric tree query params before calling the service', async () => {
    getTreeMock.mockResolvedValueOnce({ nodes: [], siblingsGroups: [], activeNodeId: null })

    await expect(
      messageHandlers['/topics/:topicId/tree'].GET({
        params: { topicId: 'topic-1' },
        query: { rootId: 'root-1', nodeId: 'node-1', depth: '3' }
      } as never)
    ).resolves.toMatchObject({ nodes: [] })

    expect(getTreeMock).toHaveBeenCalledWith('topic-1', {
      rootId: 'root-1',
      nodeId: 'node-1',
      depth: 3
    })
  })

  it('rejects excessive tree depth before calling the service', async () => {
    await expect(
      messageHandlers['/topics/:topicId/tree'].GET({
        params: { topicId: 'topic-1' },
        query: { depth: MESSAGE_TREE_MAX_DEPTH + 1 }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(getTreeMock).not.toHaveBeenCalled()
  })

  it('coerces branch pagination limit strings before calling the service', async () => {
    getBranchMessagesMock.mockResolvedValueOnce({
      items: [],
      nextCursor: undefined,
      activeNodeId: null,
      assistantId: 'assistant-1'
    })

    await expect(
      messageHandlers['/topics/:topicId/messages'].GET({
        params: { topicId: 'topic-1' },
        query: { limit: '50', cursor: 'cursor-1', nodeId: 'node-1', includeSiblings: 'false' }
      } as never)
    ).resolves.toMatchObject({ items: [] })

    expect(getBranchMessagesMock).toHaveBeenCalledWith('topic-1', {
      cursor: 'cursor-1',
      limit: 50,
      nodeId: 'node-1',
      includeSiblings: false
    })
  })

  it('rejects excessive branch pagination limits before calling the service', async () => {
    await expect(
      messageHandlers['/topics/:topicId/messages'].GET({
        params: { topicId: 'topic-1' },
        query: { limit: BRANCH_MESSAGES_MAX_LIMIT + 1 }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(getBranchMessagesMock).not.toHaveBeenCalled()
  })

  it('keeps create, update, delete, path, and sibling routes delegated', async () => {
    createMessageMock.mockResolvedValueOnce({ id: 'message-1' })
    getPathThroughMock.mockResolvedValueOnce([{ id: 'message-1' }])
    getByIdMock.mockResolvedValueOnce({ id: 'message-1' })
    updateMessageMock.mockResolvedValueOnce({ id: 'message-1', status: 'success' })
    deleteMessageMock.mockResolvedValueOnce({ deletedIds: ['message-1'] })
    createSiblingMock.mockResolvedValueOnce({ id: 'message-2' })

    await expect(
      messageHandlers['/topics/:topicId/messages'].POST({
        params: { topicId: 'topic-1' },
        body: { role: 'user', data: { parts: [] } }
      } as never)
    ).resolves.toMatchObject({ id: 'message-1' })

    await expect(
      messageHandlers['/topics/:topicId/path'].GET({
        params: { topicId: 'topic-1' },
        query: { nodeId: 'message-1' }
      } as never)
    ).resolves.toEqual([{ id: 'message-1' }])

    await expect(messageHandlers['/messages/:id'].GET({ params: { id: 'message-1' } })).resolves.toMatchObject({
      id: 'message-1'
    })

    await expect(
      messageHandlers['/messages/:id'].PATCH({
        params: { id: 'message-1' },
        body: { status: 'success' }
      } as never)
    ).resolves.toMatchObject({ id: 'message-1' })

    await expect(
      messageHandlers['/messages/:id'].DELETE({
        params: { id: 'message-1' },
        query: { cascade: 'false', activeNodeStrategy: 'clear' }
      } as never)
    ).resolves.toEqual({ deletedIds: ['message-1'] })

    await expect(
      messageHandlers['/messages/:id/siblings'].POST({
        params: { id: 'message-1' },
        body: { parts: [] }
      } as never)
    ).resolves.toMatchObject({ id: 'message-2' })

    expect(createMessageMock).toHaveBeenCalledWith('topic-1', { role: 'user', data: { parts: [] } })
    expect(getPathThroughMock).toHaveBeenCalledWith('topic-1', 'message-1')
    expect(getByIdMock).toHaveBeenCalledWith('message-1')
    expect(updateMessageMock).toHaveBeenCalledWith('message-1', { status: 'success' })
    expect(deleteMessageMock).toHaveBeenCalledWith('message-1', false, 'clear')
    expect(createSiblingMock).toHaveBeenCalledWith('message-1', { parts: [] })
  })
})
