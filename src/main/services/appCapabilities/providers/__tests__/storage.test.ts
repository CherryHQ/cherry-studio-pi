import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callRendererBridge: vi.fn(),
  storageV2Service: {
    createSnapshot: vi.fn(),
    createBackup: vi.fn(),
    validateBackup: vi.fn(),
    restoreBackup: vi.fn(),
    listAssistants: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    listFiles: vi.fn(),
    getFile: vi.fn()
  }
}))

vi.mock('../../rendererBridge', () => ({
  callRendererBridge: mocks.callRendererBridge,
  getBridgeErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
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
    mocks.callRendererBridge.mockResolvedValue(undefined)
    mocks.storageV2Service.createSnapshot.mockResolvedValue({ path: '/tmp/snapshot' })
    mocks.storageV2Service.createBackup.mockResolvedValue({ path: '/tmp/backup', metadata: {} })
    mocks.storageV2Service.validateBackup.mockResolvedValue({ ok: true })
    mocks.storageV2Service.restoreBackup.mockResolvedValue({ ok: true })
    mocks.storageV2Service.listAssistants.mockResolvedValue([])
    mocks.storageV2Service.listConversations.mockResolvedValue([])
    mocks.storageV2Service.listMessages.mockResolvedValue([])
    mocks.storageV2Service.listFiles.mockResolvedValue([])
    mocks.storageV2Service.getFile.mockResolvedValue({ id: 'file-1' })
  })

  it('defaults large Storage v2 lists to bounded pages for agents', async () => {
    await capability('storage.assistants.list').execute({}, { source: 'agent' })
    await capability('storage.conversations.list').execute({ ownerType: 'assistant' }, { source: 'agent' })
    await capability('storage.messages.list').execute({ conversationId: 'conversation-1' }, { source: 'agent' })
    await capability('storage.files.list').execute({}, { source: 'agent' })

    expect(mocks.storageV2Service.listAssistants).toHaveBeenCalledWith({ limit: 50, offset: undefined })
    expect(mocks.storageV2Service.listConversations).toHaveBeenCalledWith({
      ownerType: 'assistant',
      ownerId: undefined,
      limit: 50,
      offset: undefined
    })
    expect(mocks.storageV2Service.listMessages).toHaveBeenCalledWith('conversation-1', {
      limit: 50,
      offset: undefined
    })
    expect(mocks.storageV2Service.listFiles).toHaveBeenCalledWith({ limit: 50, offset: undefined })
  })

  it('passes explicit Storage v2 list pagination from agent input', async () => {
    await capability('storage.conversations.list').execute(
      { ownerType: ' assistant ', ownerId: ' assistant-1 ', limit: 12, offset: 24 },
      { source: 'agent' }
    )
    await capability('storage.files.list').execute({ limit: 5, offset: 10 }, { source: 'agent' })

    expect(mocks.storageV2Service.listConversations).toHaveBeenCalledWith({
      ownerType: 'assistant',
      ownerId: 'assistant-1',
      limit: 12,
      offset: 24
    })
    expect(mocks.storageV2Service.listFiles).toHaveBeenCalledWith({ limit: 5, offset: 10 })
  })

  it('clamps unsafe Storage v2 list pagination from agent input', async () => {
    await capability('storage.assistants.list').execute({ limit: 5000, offset: -8 }, { source: 'agent' })
    await capability('storage.messages.list').execute(
      { conversationId: ' conversation-1 ', limit: 'bad', offset: '12.8' },
      { source: 'agent' }
    )

    expect(mocks.storageV2Service.listAssistants).toHaveBeenCalledWith({ limit: 200, offset: 0 })
    expect(mocks.storageV2Service.listMessages).toHaveBeenCalledWith('conversation-1', {
      limit: 50,
      offset: 12
    })
  })

  it('normalizes backup paths, reasons, and snapshot reasons before calling storage services', async () => {
    await capability('storage.snapshot.create').execute({ reason: '   ' }, { source: 'agent' })
    await capability('storage.backup.create').execute({ reason: ' agent request ' }, { source: 'agent' })
    await capability('storage.backup.validate').execute({ backupPath: ' /tmp/backup ' }, { source: 'agent' })
    await capability('storage.backup.restore').execute(
      { backupPath: ' /tmp/backup ' },
      { source: 'agent', dryRun: true }
    )

    expect(mocks.storageV2Service.createSnapshot).toHaveBeenCalledWith('agent-request')
    expect(mocks.storageV2Service.createBackup).toHaveBeenCalledWith('agent request')
    expect(mocks.storageV2Service.validateBackup).toHaveBeenCalledWith('/tmp/backup')
    expect(mocks.storageV2Service.validateBackup).toHaveBeenCalledTimes(2)
    expect(mocks.storageV2Service.restoreBackup).not.toHaveBeenCalled()
  })

  it('prepares renderer runtime data before agent-triggered snapshots, backups, and restores', async () => {
    await capability('storage.snapshot.create').execute({ reason: 'before-test' }, { source: 'agent' })
    await capability('storage.backup.create').execute({ reason: 'agent request' }, { source: 'agent' })
    await capability('storage.backup.restore').execute({ backupPath: '/tmp/backup' }, { source: 'agent' })

    expect(mocks.callRendererBridge).toHaveBeenCalledTimes(3)
    expect(mocks.storageV2Service.createSnapshot).toHaveBeenCalledWith('before-test')
    expect(mocks.storageV2Service.createBackup).toHaveBeenCalledWith('agent request')
    expect(mocks.storageV2Service.restoreBackup).toHaveBeenCalledWith('/tmp/backup')
    expect(mocks.callRendererBridge.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storageV2Service.createSnapshot.mock.invocationCallOrder[0]
    )
    expect(mocks.callRendererBridge.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.storageV2Service.createBackup.mock.invocationCallOrder[0]
    )
    expect(mocks.callRendererBridge.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.storageV2Service.restoreBackup.mock.invocationCallOrder[0]
    )
  })

  it('rejects empty required storage identifiers before calling services', async () => {
    await expect(
      capability('storage.backup.validate').execute({ backupPath: '   ' }, { source: 'agent' })
    ).rejects.toThrow('Backup path is required')
    await expect(
      capability('storage.messages.list').execute({ conversationId: '   ' }, { source: 'agent' })
    ).rejects.toThrow('Conversation id is required')
    await expect(capability('storage.file.get').execute({ fileId: '   ' }, { source: 'agent' })).rejects.toThrow(
      'File id is required'
    )

    expect(mocks.storageV2Service.validateBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getFile).not.toHaveBeenCalled()
  })

  it('normalizes file ids before reading Storage v2 file records', async () => {
    await capability('storage.file.get').execute({ fileId: ' file-1 ' }, { source: 'agent' })

    expect(mocks.storageV2Service.getFile).toHaveBeenCalledWith('file-1')
  })
})
