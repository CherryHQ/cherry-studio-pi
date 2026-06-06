import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storageV2Service: {
    listAssistants: vi.fn(),
    listConversations: vi.fn(),
    listFiles: vi.fn()
  }
}))

vi.mock('@main/services/storageV2/StorageService', () => ({
  storageV2Service: mocks.storageV2Service
}))

vi.mock('../../utils', () => ({
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  sanitizeForAgent: (value: unknown) => value
}))

import { createStorageCapabilities } from '../storage'

function capability(id: string) {
  const item = createStorageCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('storage app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storageV2Service.listAssistants.mockResolvedValue([])
    mocks.storageV2Service.listConversations.mockResolvedValue([])
    mocks.storageV2Service.listFiles.mockResolvedValue([])
  })

  it('defaults large Storage v2 lists to bounded pages for agents', async () => {
    await capability('storage.assistants.list').execute({}, { source: 'agent' })
    await capability('storage.conversations.list').execute({ ownerType: 'assistant' }, { source: 'agent' })
    await capability('storage.files.list').execute({}, { source: 'agent' })

    expect(mocks.storageV2Service.listAssistants).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.storageV2Service.listConversations).toHaveBeenCalledWith({
      ownerType: 'assistant',
      ownerId: undefined,
      limit: 50,
      offset: undefined
    })
    expect(mocks.storageV2Service.listFiles).toHaveBeenCalledWith({ limit: 50, offset: undefined })
  })

  it('passes explicit Storage v2 list pagination from agent input', async () => {
    await capability('storage.conversations.list').execute(
      { ownerId: 'assistant-1', limit: 12, offset: 24 },
      { source: 'agent' }
    )
    await capability('storage.files.list').execute({ limit: 5, offset: 10 }, { source: 'agent' })

    expect(mocks.storageV2Service.listConversations).toHaveBeenCalledWith({
      ownerType: undefined,
      ownerId: 'assistant-1',
      limit: 12,
      offset: 24
    })
    expect(mocks.storageV2Service.listFiles).toHaveBeenCalledWith({ limit: 5, offset: 10 })
  })
})
