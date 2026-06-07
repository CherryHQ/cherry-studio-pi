import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserWindows: [
    {
      isDestroyed: vi.fn(() => false),
      webContents: {
        executeJavaScript: vi.fn()
      }
    }
  ],
  getAllWindows: vi.fn(),
  logger: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
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

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows
  }
}))

vi.mock('@logger', () => ({
  loggerService: mocks.logger
}))

vi.mock('@main/services/KnowledgeService', () => ({
  default: mocks.knowledgeService,
  knowledgeService: mocks.knowledgeService
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

import { RENDERER_GET_STORE_VALUE_BRIDGE } from '@shared/storeBridge'

import { createKnowledgeCapabilities } from '../knowledge'

function capability(id: string) {
  const item = createKnowledgeCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('knowledge app capabilities', () => {
  let runtimeBases: any[]
  let runtimeProviders: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeBases = []
    runtimeProviders = []
    mocks.getAllWindows.mockReturnValue(mocks.browserWindows)
    mocks.browserWindows[0].webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('typeof')) return true
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE) && script.includes('state.knowledge.bases')) {
        return runtimeBases
      }
      if (script.includes(RENDERER_GET_STORE_VALUE_BRIDGE) && script.includes('state.llm.providers')) {
        return runtimeProviders
      }
      return undefined
    })
    mocks.reduxService.dispatch.mockResolvedValue(undefined)
    mocks.storageV2KnowledgeRepository.listBases.mockResolvedValue([])
    mocks.storageV2KnowledgeRepository.importBases.mockResolvedValue(undefined)
    mocks.storageV2ProviderRepository.list.mockResolvedValue([])
    mocks.storageV2ProviderRepository.listCredentialRefs.mockResolvedValue(new Map())
    mocks.storageV2SecretVaultService.getSecret.mockResolvedValue('')
  })

  it('lists knowledge bases with lightweight item summaries by default', async () => {
    const bases = [
      {
        id: 'kb-large',
        name: 'Large Knowledge',
        model: { id: 'embed-model', provider: 'shared-provider' },
        dimensions: 1024,
        chunkSize: 500,
        chunkOverlap: 50,
        documentCount: 150,
        created_at: 1,
        updated_at: 2,
        version: 1,
        items: Array.from({ length: 150 }, (_, index) => ({
          id: `item-${index}`,
          type: 'file',
          content: `content-${index}`
        }))
      }
    ]
    runtimeBases = bases

    const result = await capability('knowledge.bases.list').execute({}, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect((result.data as any).knowledge_bases).toEqual([
      expect.objectContaining({
        id: 'kb-large',
        name: 'Large Knowledge',
        itemCount: 150
      })
    ])
    expect((result.data as any).knowledge_bases[0].items).toBeUndefined()
  })

  it('bounds knowledge base item previews when explicitly requested', async () => {
    const bases = [
      {
        id: 'kb-preview',
        name: 'Preview Knowledge',
        model: { id: 'embed-model', provider: 'shared-provider' },
        created_at: 1,
        updated_at: 2,
        version: 1,
        items: Array.from({ length: 5 }, (_, index) => ({
          id: `item-${index}`,
          type: 'file',
          content: `content-${index}`
        }))
      }
    ]
    runtimeBases = bases

    const result = await capability('knowledge.bases.list').execute(
      { includeItems: true, itemLimit: 2 },
      { source: 'agent' }
    )

    expect((result.data as any).knowledge_bases[0]).toMatchObject({
      id: 'kb-preview',
      itemCount: 5,
      itemsTruncated: 3,
      items: [
        { id: 'item-0', type: 'file', content: 'content-0' },
        { id: 'item-1', type: 'file', content: 'content-1' }
      ]
    })
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
    runtimeBases = bases
    runtimeProviders = providers
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
      mocks.browserWindows[0].webContents.executeJavaScript.mock.calls.filter(([script]) =>
        String(script).includes('"path":"state.llm.providers"')
      )
    ).toHaveLength(1)
  })

  it('normalizes knowledge search ids and falls back for invalid document counts', async () => {
    const bases = [
      {
        id: 'kb-1',
        name: 'Knowledge One',
        model: { id: 'embed-model', provider: 'shared-provider' },
        items: []
      },
      {
        id: 'kb-2',
        name: 'Knowledge Two',
        model: { id: 'embed-model', provider: 'shared-provider' },
        items: []
      }
    ]
    const providers = [
      {
        id: 'shared-provider',
        apiKey: 'sk-shared',
        apiHost: 'https://example.com/'
      }
    ]
    runtimeBases = bases
    runtimeProviders = providers
    mocks.knowledgeService.search.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ id: `result-${index}`, content: 'matched' }))
    )

    const result = await capability('knowledge.search').execute(
      {
        query: ' matched ',
        knowledge_base_ids: [' kb-1 ', '', 'kb-1'],
        document_count: 'bad'
      },
      { source: 'agent' }
    )

    expect(mocks.knowledgeService.search).toHaveBeenCalledTimes(1)
    expect((result.data as any).searched_bases).toEqual([{ id: 'kb-1', name: 'Knowledge One' }])
    expect((result.data as any).total).toBe(5)
  })

  it('bounds total knowledge search results returned to agents', async () => {
    const bases = Array.from({ length: 4 }, (_, index) => ({
      id: `kb-${index}`,
      name: `Knowledge ${index}`,
      model: { id: 'embed-model', provider: 'shared-provider' },
      items: []
    }))
    const providers = [
      {
        id: 'shared-provider',
        apiKey: 'sk-shared',
        apiHost: 'https://example.com/'
      }
    ]
    runtimeBases = bases
    runtimeProviders = providers
    mocks.knowledgeService.search.mockImplementation(async (_event, input) =>
      Array.from({ length: 3 }, (_, index) => ({
        id: `${input.base.id}-result-${index}`,
        content: 'matched'
      }))
    )

    const result = await capability('knowledge.search').execute(
      {
        query: 'matched',
        document_count: 3,
        result_limit: 5
      },
      { source: 'agent' }
    )

    expect(result.data as any).toMatchObject({
      total: 5,
      total_before_limit: 12,
      result_limit: 5,
      truncated: true,
      truncated_count: 7
    })
    expect((result.data as any).results).toHaveLength(5)
    expect(result.warnings).toEqual([
      'Returned 5 of 12 knowledge search results; narrow knowledge_base_ids or raise result_limit.'
    ])
  })

  it('normalizes knowledge add and reset base ids before calling services', async () => {
    const base = {
      id: 'kb-1',
      name: 'Knowledge One',
      model: { id: 'embed-model', provider: 'shared-provider' },
      items: []
    }
    const providers = [
      {
        id: 'shared-provider',
        apiKey: 'sk-shared',
        apiHost: 'https://example.com/'
      }
    ]
    runtimeBases = [base]
    runtimeProviders = providers
    mocks.knowledgeService.add.mockResolvedValue({ ok: true })

    await capability('knowledge.item.add').execute(
      { baseId: ' kb-1 ', item: { id: 'item-1', type: 'note', content: 'hello' } },
      { source: 'agent' }
    )
    const dryRun = await capability('knowledge.base.reset').execute(
      { baseId: ' kb-1 ' },
      { source: 'agent', dryRun: true }
    )

    expect(mocks.knowledgeService.add).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        item: { id: 'item-1', type: 'note', content: 'hello' }
      })
    )
    expect(dryRun.data).toEqual({ baseId: 'kb-1' })
    expect(mocks.knowledgeService.reset).not.toHaveBeenCalled()
  })

  it('rejects empty knowledge base ids and invalid knowledge items before calling services', async () => {
    runtimeBases = [{ id: 'kb-1', name: 'Knowledge One', items: [] }]

    await expect(capability('knowledge.base.reset').execute({ baseId: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Knowledge base id is required'
    )
    await expect(
      capability('knowledge.item.add').execute({ baseId: 'kb-1', item: [] }, { source: 'agent' })
    ).rejects.toThrow('Knowledge item is required')

    expect(mocks.knowledgeService.add).not.toHaveBeenCalled()
    expect(mocks.knowledgeService.reset).not.toHaveBeenCalled()
  })
})
