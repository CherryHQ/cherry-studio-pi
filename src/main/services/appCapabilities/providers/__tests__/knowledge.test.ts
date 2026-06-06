import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    withContext: vi.fn(() => ({
      warn: vi.fn()
    }))
  },
  knowledgeService: {
    search: vi.fn(),
    create: vi.fn(),
    add: vi.fn(),
    reset: vi.fn()
  },
  reduxService: {
    select: vi.fn(),
    dispatch: vi.fn()
  },
  storageV2KnowledgeRepository: {
    listBases: vi.fn(),
    importBases: vi.fn()
  },
  storageV2ProviderRepository: {
    list: vi.fn(),
    listCredentialRefs: vi.fn()
  },
  storageV2SecretVaultService: {
    getSecret: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: mocks.logger
}))

vi.mock('@main/services/KnowledgeService', () => ({
  default: mocks.knowledgeService
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: mocks.reduxService
}))

vi.mock('@main/services/storageV2/SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.storageV2SecretVaultService
}))

vi.mock('@main/services/storageV2/StorageV2Repositories', () => ({
  storageV2KnowledgeRepository: mocks.storageV2KnowledgeRepository,
  storageV2ProviderRepository: mocks.storageV2ProviderRepository
}))

vi.mock('../../utils', () => ({
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  }),
  sanitizeForAgent: (value: unknown) => value
}))

import { createKnowledgeCapabilities } from '../knowledge'

function capability(id: string) {
  const item = createKnowledgeCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('knowledge app capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
    mocks.storageV2KnowledgeRepository.listBases.mockResolvedValue([])
    mocks.storageV2KnowledgeRepository.importBases.mockResolvedValue(undefined)
    mocks.storageV2ProviderRepository.list.mockResolvedValue([])
    mocks.storageV2ProviderRepository.listCredentialRefs.mockResolvedValue(new Map())
    mocks.storageV2SecretVaultService.getSecret.mockResolvedValue('')
  })

  it('bounds concurrent knowledge searches and reuses provider config during one query', async () => {
    const bases = Array.from({ length: 8 }, (_, index) => ({
      id: `kb-${index}`,
      name: `Knowledge ${index}`,
      model: { id: 'embed-model', provider: 'shared-provider' },
      dimensions: 1024,
      chunkSize: 500,
      chunkOverlap: 50,
      documentCount: 10,
      items: []
    }))
    const providers = [
      {
        id: 'shared-provider',
        apiKey: 'sk-shared',
        apiHost: 'https://example.com/'
      }
    ]
    let activeSearches = 0
    let maxActiveSearches = 0
    mocks.reduxService.select.mockImplementation(async (selector: string) => {
      if (selector === 'state.knowledge.bases') return bases
      if (selector === 'state.llm.providers') return providers
      return null
    })
    mocks.knowledgeService.search.mockImplementation(async (_event, input) => {
      activeSearches += 1
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeSearches -= 1
      return [{ id: `result-${input.base.id}`, content: 'matched' }]
    })

    const result = await capability('knowledge.search').execute({ query: 'matched' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).total).toBe(8)
    expect(mocks.knowledgeService.search).toHaveBeenCalledTimes(8)
    expect(maxActiveSearches).toBeLessThanOrEqual(3)
    expect(
      mocks.reduxService.select.mock.calls.filter(([selector]) => selector === 'state.llm.providers')
    ).toHaveLength(1)
  })
})
