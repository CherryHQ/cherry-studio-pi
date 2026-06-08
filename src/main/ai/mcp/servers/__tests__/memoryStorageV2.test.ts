import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fs: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn()
  },
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  },
  secretVault: {
    getSecret: vi.fn(),
    setSecret: vi.fn()
  },
  settingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('fs', () => ({
  promises: mocks.fs
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@main/utils/file', () => ({
  getConfigDir: vi.fn(() => '/mock/config')
}))

vi.mock('@main/services/storageV2/SecretVaultService', () => ({
  storageV2SecretVaultService: mocks.secretVault
}))

vi.mock('@main/services/storageV2/StorageV2Repositories', () => ({
  storageV2SettingsRepository: mocks.settingsRepository
}))

async function loadMemoryServer() {
  vi.resetModules()
  return (await import('../memory')).default
}

async function callTool(server: any, name: string, args: Record<string, unknown>) {
  const handlers = server.server._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

const secretRef = 'storage-v2://secret/mcp-memory/default/graph'
const memoryPath = '/mock/config/memory.json'
const emptyGraph = { entities: [], relations: [] }
const storageGraph = {
  entities: [{ name: 'Ada', entityType: 'person', observations: ['Loves durable storage'] }],
  relations: []
}
const legacyGraph = {
  entities: [{ name: 'Grace', entityType: 'person', observations: ['Legacy file'] }],
  relations: []
}

describe('MemoryServer Storage v2 graph persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fs.access.mockResolvedValue(undefined)
    mocks.fs.mkdir.mockResolvedValue(undefined)
    mocks.fs.readFile.mockResolvedValue(JSON.stringify(emptyGraph))
    mocks.fs.writeFile.mockResolvedValue(undefined)
    mocks.secretVault.getSecret.mockResolvedValue(null)
    mocks.secretVault.setSecret.mockResolvedValue(secretRef)
    mocks.settingsRepository.get.mockResolvedValue(null)
    mocks.settingsRepository.set.mockResolvedValue({ key: 'mcp.memory.graph' })
  })

  it('loads the memory graph from Storage v2 before the legacy file', async () => {
    mocks.settingsRepository.get.mockResolvedValue({ graphSecretRef: secretRef })
    mocks.secretVault.getSecret.mockResolvedValue(JSON.stringify(storageGraph))
    mocks.fs.readFile.mockResolvedValue(JSON.stringify(legacyGraph))
    const MemoryServer = await loadMemoryServer()

    const result = await callTool(new MemoryServer(memoryPath), 'read_graph', {})

    expect(JSON.parse(result.content[0].text)).toEqual(storageGraph)
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
    expect(mocks.fs.writeFile).toHaveBeenCalledWith(memoryPath, JSON.stringify(storageGraph, null, 2))
  })

  it('mirrors memory graph mutations to Storage v2 before writing memory.json', async () => {
    const MemoryServer = await loadMemoryServer()
    const server = new MemoryServer(memoryPath)
    await callTool(server, 'read_graph', {})
    vi.clearAllMocks()
    mocks.secretVault.setSecret.mockResolvedValue(secretRef)
    mocks.settingsRepository.set.mockResolvedValue({ key: 'mcp.memory.graph' })
    mocks.fs.writeFile.mockResolvedValue(undefined)

    await callTool(server, 'create_entities', {
      entities: [{ name: 'Ada', entityType: 'person', observations: ['New fact'] }]
    })

    const storedGraph = JSON.parse(mocks.secretVault.setSecret.mock.calls[0][3])
    expect(storedGraph.entities).toEqual([{ name: 'Ada', entityType: 'person', observations: ['New fact'] }])
    expect(mocks.settingsRepository.set).toHaveBeenCalledWith(
      'mcp.memory.graph',
      expect.objectContaining({ graphSecretRef: secretRef, updatedAt: expect.any(String) }),
      'mcp-memory'
    )
    expect(mocks.secretVault.setSecret.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fs.writeFile.mock.invocationCallOrder[0]
    )
  })

  it('falls back to legacy memory.json and mirrors it into Storage v2', async () => {
    mocks.fs.readFile.mockResolvedValue(JSON.stringify(legacyGraph))
    const MemoryServer = await loadMemoryServer()

    const result = await callTool(new MemoryServer(memoryPath), 'read_graph', {})

    expect(JSON.parse(result.content[0].text)).toEqual(legacyGraph)
    expect(mocks.secretVault.setSecret).toHaveBeenCalledWith(
      'mcp-memory',
      'default',
      'graph',
      JSON.stringify(legacyGraph)
    )
  })

  it('does not resurrect legacy memory.json after Storage v2 is cleared', async () => {
    mocks.settingsRepository.get.mockResolvedValue({ clearedAt: '2026-05-29T00:00:00.000Z' })
    mocks.fs.readFile.mockResolvedValue(JSON.stringify(legacyGraph))
    const MemoryServer = await loadMemoryServer()

    const result = await callTool(new MemoryServer(memoryPath), 'read_graph', {})

    expect(JSON.parse(result.content[0].text)).toEqual(emptyGraph)
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
    expect(mocks.secretVault.getSecret).not.toHaveBeenCalled()
  })
})
