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
    createBase: vi.fn(),
    addItems: vi.fn(),
    listRootItems: vi.fn(),
    reindexItems: vi.fn()
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

  it('lists knowledge bases from Storage v2 with lightweight item summaries by default', async () => {
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
    mocks.storageV2KnowledgeRepository.listBases.mockResolvedValueOnce(bases)

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
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
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
    mocks.knowledgeService.search.mockImplementation(async (baseId: string) => {
      activeSearches += 1
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeSearches -= 1
      return [{ id: `result-${baseId}`, content: 'matched' }]
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

  it('uses Storage v2 provider config for knowledge search without the renderer bridge', async () => {
    const base = {
      id: 'kb-storage',
      name: 'Storage Knowledge',
      model: { id: 'embed-model', provider: 'shared-provider' },
      dimensions: 1024,
      chunkSize: 500,
      chunkOverlap: 50,
      documentCount: 10,
      items: []
    }
    mocks.storageV2KnowledgeRepository.listBases.mockResolvedValueOnce([base])
    mocks.storageV2ProviderRepository.list.mockResolvedValueOnce([
      {
        id: 'shared-provider',
        apiHost: 'https://storage.example.com/'
      }
    ])
    mocks.storageV2ProviderRepository.listCredentialRefs.mockResolvedValueOnce(
      new Map([['shared-provider', { apiKey: 'secret-ref' }]])
    )
    mocks.storageV2SecretVaultService.getSecret.mockResolvedValueOnce('sk-storage')
    mocks.knowledgeService.search.mockResolvedValueOnce([{ id: 'result-kb-storage', content: 'matched' }])

    const result = await capability('knowledge.search').execute({ query: 'matched' }, { source: 'agent' })

    expect(result.ok).toBe(true)
    expect(mocks.storageV2SecretVaultService.getSecret).toHaveBeenCalledWith('secret-ref')
    expect(mocks.knowledgeService.search).toHaveBeenCalledWith('kb-storage', 'matched')
    expect(mocks.browserWindows[0].webContents.executeJavaScript).not.toHaveBeenCalled()
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

  it('rejects invalid knowledge search text inputs before reading or searching', async () => {
    await expect(capability('knowledge.search').execute({ query: ['matched'] }, { source: 'agent' })).rejects.toThrow(
      'Knowledge search query must be a string'
    )
    await expect(
      capability('knowledge.search').execute({ query: 'matched', knowledge_base_ids: 'kb-1' }, { source: 'agent' })
    ).rejects.toThrow('Knowledge base ids must be an array')
    await expect(
      capability('knowledge.search').execute({ query: 'matched', knowledge_base_ids: [123] }, { source: 'agent' })
    ).rejects.toThrow('Knowledge base id must be a string')

    expect(mocks.storageV2KnowledgeRepository.listBases).not.toHaveBeenCalled()
    expect(mocks.knowledgeService.search).not.toHaveBeenCalled()
  })

  it('rejects unknown requested knowledge base ids before searching', async () => {
    runtimeBases = [
      {
        id: 'kb-1',
        name: 'Knowledge One',
        model: { id: 'embed-model', provider: 'shared-provider' },
        items: []
      }
    ]

    await expect(
      capability('knowledge.search').execute(
        {
          query: 'matched',
          knowledge_base_ids: [' kb-1 ', 'missing-kb']
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Knowledge base not found: missing-kb')

    expect(mocks.knowledgeService.search).not.toHaveBeenCalled()
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
    mocks.knowledgeService.search.mockImplementation(async (baseId: string) =>
      Array.from({ length: 3 }, (_, index) => ({
        id: `${baseId}-result-${index}`,
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

  it('uses the runtime-created knowledge base id when initializing vector storage', async () => {
    mocks.knowledgeService.createBase.mockResolvedValueOnce({
      id: 'runtime-kb-1',
      name: 'Runtime Knowledge',
      groupId: null,
      dimensions: 1024,
      embeddingModelId: 'shared-provider::embed-model',
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: 500,
      chunkOverlap: 50,
      threshold: 0.4,
      documentCount: 12,
      searchMode: 'vector',
      hybridAlpha: null,
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:01:00.000Z'
    })

    const result = await capability('knowledge.base.create').execute(
      {
        id: 'requested-kb-id',
        name: 'Runtime Knowledge',
        model: { id: 'embed-model', provider: 'shared-provider', name: 'Embed Model', group: 'shared-provider' },
        dimensions: 1024,
        chunkSize: 500,
        chunkOverlap: 50,
        documentCount: 12,
        threshold: 0.4
      },
      { source: 'agent' }
    )

    expect(mocks.knowledgeService.createBase).toHaveBeenCalledWith({
      name: 'Runtime Knowledge',
      dimensions: 1024,
      embeddingModelId: 'shared-provider::embed-model',
      chunkSize: 500,
      chunkOverlap: 50,
      documentCount: 12,
      threshold: 0.4,
      rerankModelId: undefined,
      fileProcessorId: undefined,
      searchMode: 'vector'
    })
    expect(mocks.storageV2KnowledgeRepository.importBases).toHaveBeenCalledTimes(1)
    expect(mocks.storageV2KnowledgeRepository.importBases).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'runtime-kb-1',
          name: 'Runtime Knowledge',
          dimensions: 1024,
          chunkSize: 500,
          chunkOverlap: 50,
          documentCount: 12,
          threshold: 0.4
        })
      ],
      { pruneMissing: false }
    )
    expect((result.data as any).id).toBe('runtime-kb-1')
    expect(result.warnings).toEqual([])
  })

  it('keeps metadata-only creation available when vector initialization is disabled', async () => {
    const result = await capability('knowledge.base.create').execute(
      {
        id: 'metadata-kb',
        name: 'Metadata Knowledge',
        model: { id: 'embed-model', provider: 'shared-provider', name: 'Embed Model', group: 'shared-provider' },
        initialize: false
      },
      { source: 'agent' }
    )

    expect(mocks.knowledgeService.createBase).not.toHaveBeenCalled()
    expect(mocks.storageV2KnowledgeRepository.importBases).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'metadata-kb', name: 'Metadata Knowledge' })],
      { pruneMissing: false }
    )
    expect((result.data as any).id).toBe('metadata-kb')
  })

  it('preserves explicit knowledge base metadata timestamps and items', async () => {
    const result = await capability('knowledge.base.create').execute(
      {
        id: 'metadata-kb',
        name: 'Metadata Knowledge',
        model: { id: 'embed-model', provider: 'shared-provider', name: 'Embed Model', group: 'shared-provider' },
        created_at: 0,
        items: [{ id: 'item-1', type: 'note', content: 'hello' }],
        initialize: false
      },
      { source: 'agent' }
    )

    expect(mocks.storageV2KnowledgeRepository.importBases).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'metadata-kb',
          created_at: 0,
          items: [{ id: 'item-1', type: 'note', content: 'hello' }]
        })
      ],
      { pruneMissing: false }
    )
    expect(result.data as any).toMatchObject({
      id: 'metadata-kb',
      created_at: 0,
      items: [{ id: 'item-1', type: 'note', content: 'hello' }]
    })
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
    mocks.knowledgeService.addItems.mockResolvedValue({ ok: true })

    await capability('knowledge.item.add').execute(
      { baseId: ' kb-1 ', item: { id: 'item-1', type: 'note', content: 'hello' } },
      { source: 'agent' }
    )
    const dryRun = await capability('knowledge.base.reset').execute(
      { baseId: ' kb-1 ' },
      { source: 'agent', dryRun: true }
    )

    expect(mocks.knowledgeService.addItems).toHaveBeenCalledWith('kb-1', [
      { id: 'item-1', type: 'note', content: 'hello' }
    ])
    expect(dryRun.data).toEqual({ baseId: 'kb-1' })
    expect(mocks.knowledgeService.listRootItems).not.toHaveBeenCalled()
    expect(mocks.knowledgeService.reindexItems).not.toHaveBeenCalled()
  })

  it('rejects invalid knowledge base creation input before writing metadata', async () => {
    await expect(
      capability('knowledge.base.create').execute({ name: 'Knowledge One' }, { source: 'agent' })
    ).rejects.toThrow('Knowledge base model is required')
    await expect(
      capability('knowledge.base.create').execute({ name: 'Knowledge One', model: [] }, { source: 'agent' })
    ).rejects.toThrow('Knowledge base model is required')
    await expect(
      capability('knowledge.base.create').execute(
        {
          id: 123,
          name: 'Knowledge One',
          model: { id: 'embed-model', provider: 'shared-provider' },
          initialize: false
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Knowledge base id must be a string')
    await expect(
      capability('knowledge.base.create').execute(
        {
          name: 'Knowledge One',
          model: { id: 'embed-model', provider: 'shared-provider' },
          items: { id: 'item-1' },
          initialize: false
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Knowledge base items must be an array')
    await expect(
      capability('knowledge.base.create').execute(
        {
          name: 'Knowledge One',
          model: { id: 'embed-model', provider: 'shared-provider' },
          items: [null],
          initialize: false
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Knowledge item is required')
    await expect(
      capability('knowledge.base.create').execute(
        {
          name: 'Knowledge One',
          model: { id: 'embed-model', provider: 'shared-provider' },
          created_at: { value: Date.now() },
          initialize: false
        },
        { source: 'agent' }
      )
    ).rejects.toThrow('Knowledge base created_at must be a finite number or valid date string')

    expect(mocks.storageV2KnowledgeRepository.importBases).not.toHaveBeenCalled()
    expect(mocks.knowledgeService.createBase).not.toHaveBeenCalled()
  })

  it('rejects empty knowledge base ids and invalid knowledge items before calling services', async () => {
    runtimeBases = [{ id: 'kb-1', name: 'Knowledge One', items: [] }]

    await expect(capability('knowledge.base.reset').execute({ baseId: '   ' }, { source: 'agent' })).rejects.toThrow(
      'Knowledge base id is required'
    )
    await expect(capability('knowledge.base.reset').execute({ baseId: 123 }, { source: 'agent' })).rejects.toThrow(
      'Knowledge base id must be a string'
    )
    await expect(
      capability('knowledge.item.add').execute({ baseId: 'kb-1', item: [] }, { source: 'agent' })
    ).rejects.toThrow('Knowledge item is required')
    await expect(
      capability('knowledge.item.add').execute({ baseId: false, item: { id: 'item-1' } }, { source: 'agent' })
    ).rejects.toThrow('Knowledge base id must be a string')

    expect(mocks.knowledgeService.addItems).not.toHaveBeenCalled()
    expect(mocks.knowledgeService.reindexItems).not.toHaveBeenCalled()
  })
})
