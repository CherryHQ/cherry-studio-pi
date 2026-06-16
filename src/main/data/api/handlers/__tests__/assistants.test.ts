import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listMock,
  createMock,
  getByIdMock,
  updateMock,
  deleteMock,
  reorderMock,
  reorderBatchMock,
  upsertStorageV2AssistantMock,
  deleteStorageV2AssistantMock
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  upsertStorageV2AssistantMock: vi.fn(),
  deleteStorageV2AssistantMock: vi.fn()
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    list: listMock,
    create: createMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@main/services/storageV2/StorageService', () => ({
  storageV2Service: {
    upsertAssistant: upsertStorageV2AssistantMock,
    deleteAssistant: deleteStorageV2AssistantMock
  }
}))

import { assistantHandlers } from '../assistants'

const ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ASSISTANT_ID = '33333333-3333-4333-8333-333333333333'
const TAG_ID = '22222222-2222-4222-8222-222222222222'

describe('assistantHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue({
      items: [
        {
          id: ASSISTANT_ID,
          name: 'Existing Assistant'
        }
      ],
      total: 1,
      page: 1
    })
    upsertStorageV2AssistantMock.mockResolvedValue(undefined)
    deleteStorageV2AssistantMock.mockResolvedValue({ deleted: true })
  })

  describe('/assistants', () => {
    it('should forward parsed list query params', async () => {
      listMock.mockResolvedValueOnce({ items: [], total: 0, page: 1 })

      await assistantHandlers['/assistants'].GET({
        query: {
          updatedAtFrom: '2026-05-01T00:00:00.000Z',
          sortBy: 'updatedAt',
          sortOrder: 'desc'
        }
      } as never)

      expect(listMock).toHaveBeenCalledWith({
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        page: 1,
        limit: 100
      })
    })

    it('should reject legacy numeric updatedAtFrom and orderBy list params', async () => {
      await expect(
        assistantHandlers['/assistants'].GET({
          query: { updatedAtFrom: 1, orderBy: 'desc' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listMock).not.toHaveBeenCalled()

      await expect(
        assistantHandlers['/assistants'].GET({
          query: { updatedAtFrom: '2026-05-01T00:00:00.000Z', orderBy: 'desc' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listMock).not.toHaveBeenCalled()
    })

    it('should forward create bodies without injecting defaults', async () => {
      createMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'New Assistant' })
      listMock.mockResolvedValueOnce({
        items: [{ id: ASSISTANT_ID, name: 'New Assistant' }],
        total: 1,
        page: 1
      })

      await expect(
        assistantHandlers['/assistants'].POST({
          body: { name: 'New Assistant' }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(createMock).toHaveBeenCalledWith({
        name: 'New Assistant'
      })
      expect(upsertStorageV2AssistantMock).toHaveBeenCalledWith({ id: ASSISTANT_ID, name: 'New Assistant' }, 0)
    })

    it('should keep create successful when Storage v2 assistant mirroring fails', async () => {
      createMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'New Assistant' })
      listMock.mockResolvedValueOnce({
        items: [{ id: ASSISTANT_ID, name: 'New Assistant' }],
        total: 1,
        page: 1
      })
      upsertStorageV2AssistantMock.mockRejectedValueOnce(new Error('storage unavailable'))

      await expect(
        assistantHandlers['/assistants'].POST({
          body: { name: 'New Assistant' }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })
    })

    it('should reject partial settings instead of filling nested defaults', async () => {
      await expect(
        assistantHandlers['/assistants'].POST({
          body: {
            name: 'New Assistant',
            settings: { maxTokens: 8192 }
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject direct orderKey writes on create', async () => {
      await expect(
        assistantHandlers['/assistants'].POST({
          body: { name: 'New Assistant', orderKey: 'a0' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/:id', () => {
    it('should forward tag-only PATCH bodies without defaulted column fields', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { tagIds: [TAG_ID] }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, { tagIds: [TAG_ID] })
      expect(upsertStorageV2AssistantMock).toHaveBeenCalledWith({ id: ASSISTANT_ID, name: 'Existing Assistant' }, 0)
    })

    it('should forward relation-only PATCH bodies without defaulted column fields', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { mcpServerIds: ['srv-1'], knowledgeBaseIds: ['kb-1'] }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })
    })

    it('should forward empty PATCH bodies without injecting create defaults', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: {}
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, {})
    })

    it('should forward partial settings updates without injecting unrelated defaults', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { settings: { maxTokens: 8192 } }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, { settings: { maxTokens: 8192 } })
    })

    it('should reject invalid tag ids before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { tagIds: ['not-a-uuid'] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject direct orderKey writes on update', async () => {
      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { orderKey: 'a0' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should tombstone deleted assistants in Storage v2 and refresh remaining order', async () => {
      deleteMock.mockResolvedValueOnce(undefined)
      listMock.mockResolvedValueOnce({
        items: [{ id: OTHER_ASSISTANT_ID, name: 'Other Assistant' }],
        total: 1,
        page: 1
      })

      await expect(
        assistantHandlers['/assistants/:id'].DELETE({
          params: { id: ASSISTANT_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(deleteMock).toHaveBeenCalledWith(ASSISTANT_ID)
      expect(deleteStorageV2AssistantMock).toHaveBeenCalledWith(ASSISTANT_ID)
      expect(upsertStorageV2AssistantMock).toHaveBeenCalledWith({ id: OTHER_ASSISTANT_ID, name: 'Other Assistant' }, 0)
    })
  })

  describe('/assistants/:id/order', () => {
    it('should forward a parsed single reorder anchor', async () => {
      reorderMock.mockResolvedValueOnce(undefined)
      listMock.mockResolvedValueOnce({
        items: [
          { id: OTHER_ASSISTANT_ID, name: 'Other Assistant' },
          { id: ASSISTANT_ID, name: 'Existing Assistant' }
        ],
        total: 2,
        page: 1
      })

      await expect(
        assistantHandlers['/assistants/:id/order'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { before: OTHER_ASSISTANT_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderMock).toHaveBeenCalledWith(ASSISTANT_ID, { before: OTHER_ASSISTANT_ID })
      expect(upsertStorageV2AssistantMock).toHaveBeenCalledWith({ id: OTHER_ASSISTANT_ID, name: 'Other Assistant' }, 0)
      expect(upsertStorageV2AssistantMock).toHaveBeenCalledWith({ id: ASSISTANT_ID, name: 'Existing Assistant' }, 1)
    })

    it('should reject malformed anchors before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/:id/order'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { before: OTHER_ASSISTANT_ID, after: OTHER_ASSISTANT_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/order:batch', () => {
    it('should forward parsed batch reorder moves', async () => {
      reorderBatchMock.mockResolvedValueOnce(undefined)

      await expect(
        assistantHandlers['/assistants/order:batch'].PATCH({
          body: {
            moves: [
              { id: ASSISTANT_ID, anchor: { position: 'first' } },
              { id: OTHER_ASSISTANT_ID, anchor: { after: ASSISTANT_ID } }
            ]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderBatchMock).toHaveBeenCalledWith([
        { id: ASSISTANT_ID, anchor: { position: 'first' } },
        { id: OTHER_ASSISTANT_ID, anchor: { after: ASSISTANT_ID } }
      ])
    })

    it('should reject an empty move list before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/order:batch'].PATCH({ body: { moves: [] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
