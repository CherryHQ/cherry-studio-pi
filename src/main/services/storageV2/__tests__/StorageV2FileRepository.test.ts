import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: {
    execute: vi.fn()
  },
  database: {
    getClient: vi.fn()
  }
}))

vi.mock('../StorageV2Database', () => ({
  storageV2Database: mocks.database
}))

describe('StorageV2FileRepository', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.database.getClient.mockResolvedValue(mocks.client)
  })

  it('normalizes blob MIME values to legacy file types', async () => {
    mocks.client.execute.mockResolvedValue({
      rows: [
        {
          id: 'file-1',
          original_name: 'notes.txt',
          display_name: null,
          metadata_json: '{}',
          created_at: '2026-01-01T00:00:00.000Z',
          blob_ext: '.txt',
          blob_mime: 'text/plain',
          blob_size: 42
        }
      ]
    })

    const { StorageV2FileRepository } = await import('../StorageV2Repositories')
    const files = await new StorageV2FileRepository().list()

    expect(files[0]).toEqual(
      expect.objectContaining({
        id: 'file-1',
        type: 'text',
        ext: '.txt',
        size: 42
      })
    )
  })
})
