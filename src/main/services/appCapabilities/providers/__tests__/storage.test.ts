import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callRendererBridge: vi.fn(),
  runtimeFlush: {
    flushMainStorageV2RuntimeMirrors: vi.fn()
  },
  storageV2Service: {
    getDataRoot: vi.fn(),
    healthCheck: vi.fn(),
    getStats: vi.fn(),
    createSnapshot: vi.fn(),
    createBackup: vi.fn(),
    getBackupOverview: vi.fn(),
    validateBackup: vi.fn(),
    restoreBackup: vi.fn(),
    listProviders: vi.fn(),
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

vi.mock('@main/services/AppRuntimeSaveService', () => ({
  flushMainStorageV2RuntimeMirrors: mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors
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

import { RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE } from '@shared/dataSyncBridge'

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
    mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mockResolvedValue(undefined)
    mocks.storageV2Service.getDataRoot.mockReturnValue('/tmp/cherry-data')
    mocks.storageV2Service.healthCheck.mockResolvedValue({ ok: true })
    mocks.storageV2Service.getStats.mockResolvedValue({ providers: 0 })
    mocks.storageV2Service.createSnapshot.mockResolvedValue({ path: '/tmp/snapshot' })
    mocks.storageV2Service.createBackup.mockResolvedValue({ path: '/tmp/backup', metadata: {} })
    mocks.storageV2Service.getBackupOverview.mockResolvedValue({ backups: [] })
    mocks.storageV2Service.validateBackup.mockResolvedValue({ ok: true })
    mocks.storageV2Service.restoreBackup.mockResolvedValue({ ok: true })
    mocks.storageV2Service.listProviders.mockResolvedValue([])
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

  it('declares storage backup and snapshot capabilities with complete local data side effects', () => {
    expect(capability('storage.backup.create')).toMatchObject({
      permissions: ['storage.backup.write'],
      sideEffects: expect.arrayContaining(['database.read', 'filesystem.read', 'filesystem.write'])
    })
    expect(capability('storage.backup.restore')).toMatchObject({
      permissions: ['storage.backup.restore'],
      sideEffects: expect.arrayContaining([
        'database.read',
        'database.write',
        'filesystem.read',
        'filesystem.write',
        'filesystem.delete'
      ])
    })
    expect(capability('storage.snapshot.create')).toMatchObject({
      permissions: ['storage.snapshot.write'],
      sideEffects: expect.arrayContaining(['database.read', 'database.write', 'filesystem.write'])
    })
  })

  it('flushes main runtime mirrors and prepares renderer runtime data before agent-triggered snapshots, backups, and restores', async () => {
    await capability('storage.snapshot.create').execute({ reason: 'before-test' }, { source: 'agent' })
    await capability('storage.backup.create').execute({ reason: 'agent request' }, { source: 'agent' })
    await capability('storage.backup.restore').execute({ backupPath: '/tmp/backup' }, { source: 'agent' })

    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors).toHaveBeenCalledTimes(3)
    expect(mocks.callRendererBridge).toHaveBeenCalledTimes(3)
    expect(mocks.callRendererBridge).toHaveBeenNthCalledWith(
      1,
      RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
      undefined,
      expect.objectContaining({
        checkTimeoutMs: 800,
        timeoutMs: 1_500
      })
    )
    expect(mocks.callRendererBridge).toHaveBeenNthCalledWith(
      2,
      RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
      undefined,
      expect.objectContaining({
        checkTimeoutMs: 800,
        timeoutMs: 1_500
      })
    )
    expect(mocks.callRendererBridge).toHaveBeenNthCalledWith(
      3,
      RENDERER_PREPARE_STORAGE_V2_FOR_DATA_SYNC_BRIDGE,
      undefined,
      expect.objectContaining({
        checkTimeoutMs: 800,
        timeoutMs: 1_500
      })
    )
    expect(mocks.storageV2Service.createSnapshot).toHaveBeenCalledWith('before-test')
    expect(mocks.storageV2Service.createBackup).toHaveBeenCalledWith('agent request')
    expect(mocks.storageV2Service.restoreBackup).toHaveBeenCalledWith('/tmp/backup')
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.callRendererBridge.mock.invocationCallOrder[0]
    )
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.callRendererBridge.mock.invocationCallOrder[1]
    )
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.callRendererBridge.mock.invocationCallOrder[2]
    )
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

  it('stops storage writes when renderer preparation is cancelled by the caller signal', async () => {
    const controller = new AbortController()
    mocks.callRendererBridge.mockImplementationOnce(async () => {
      controller.abort(new Error('agent cancelled storage backup'))
      throw new Error('agent cancelled storage backup')
    })

    await expect(
      capability('storage.backup.create').execute(
        { reason: 'agent request' },
        { source: 'agent', signal: controller.signal }
      )
    ).rejects.toThrow('agent cancelled storage backup')

    expect(mocks.callRendererBridge).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
  })

  it('stops storage writes when main runtime mirror flushing fails', async () => {
    mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors.mockRejectedValueOnce(new Error('provider mirror is locked'))

    await expect(
      capability('storage.backup.create').execute({ reason: 'agent request' }, { source: 'agent' })
    ).rejects.toThrow('provider mirror is locked')

    expect(mocks.callRendererBridge).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
  })

  it('stops storage capabilities before service calls when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped storage work')
    const context = { source: 'agent' as const, signal: controller.signal }

    await expect(capability('storage.dataRoot.get').execute({}, context)).rejects.toThrow('agent stopped storage work')
    await expect(capability('storage.health.check').execute({}, context)).rejects.toThrow('agent stopped storage work')
    await expect(capability('storage.stats.get').execute({}, context)).rejects.toThrow('agent stopped storage work')
    await expect(capability('storage.backup.create').execute({ reason: 'agent request' }, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.backup.overview').execute({}, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.backup.validate').execute({ backupPath: '/tmp/backup' }, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.backup.restore').execute({ backupPath: '/tmp/backup' }, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.snapshot.create').execute({ reason: 'agent request' }, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.providers.list').execute({}, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.assistants.list').execute({}, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(capability('storage.conversations.list').execute({}, context)).rejects.toThrow(
      'agent stopped storage work'
    )
    await expect(
      capability('storage.messages.list').execute({ conversationId: 'conversation-1' }, context)
    ).rejects.toThrow('agent stopped storage work')
    await expect(capability('storage.files.list').execute({}, context)).rejects.toThrow('agent stopped storage work')
    await expect(capability('storage.file.get').execute({ fileId: 'file-1' }, context)).rejects.toThrow(
      'agent stopped storage work'
    )

    expect(mocks.callRendererBridge).not.toHaveBeenCalled()
    expect(mocks.runtimeFlush.flushMainStorageV2RuntimeMirrors).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getDataRoot).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.healthCheck).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getStats).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getBackupOverview).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.validateBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.restoreBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createSnapshot).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listProviders).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listAssistants).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listConversations).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listFiles).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getFile).not.toHaveBeenCalled()
  })

  it('does not return stale storage results when cancellation happens during service work', async () => {
    const backupController = new AbortController()
    mocks.storageV2Service.createBackup.mockImplementationOnce(async () => {
      backupController.abort(new Error('agent cancelled during backup'))
      return { path: '/tmp/backup-after-cancel', metadata: {} }
    })

    await expect(
      capability('storage.backup.create').execute(
        { reason: 'agent request' },
        { source: 'agent', signal: backupController.signal }
      )
    ).rejects.toThrow('agent cancelled during backup')

    const snapshotController = new AbortController()
    mocks.storageV2Service.createSnapshot.mockImplementationOnce(async () => {
      snapshotController.abort('agent cancelled during snapshot')
      return { path: '/tmp/snapshot-after-cancel' }
    })

    await expect(
      capability('storage.snapshot.create').execute(
        { reason: 'agent request' },
        { source: 'agent', signal: snapshotController.signal }
      )
    ).rejects.toThrow('agent cancelled during snapshot')

    const healthController = new AbortController()
    mocks.storageV2Service.healthCheck.mockImplementationOnce(async () => {
      healthController.abort('agent cancelled during health check')
      return { ok: true }
    })

    await expect(
      capability('storage.health.check').execute({}, { source: 'agent', signal: healthController.signal })
    ).rejects.toThrow('agent cancelled during health check')
  })

  it('rejects empty required storage identifiers before calling services', async () => {
    await expect(
      capability('storage.backup.validate').execute({ backupPath: '   ' }, { source: 'agent' })
    ).rejects.toThrow('备份路径 不能为空')
    await expect(
      capability('storage.messages.list').execute({ conversationId: '   ' }, { source: 'agent' })
    ).rejects.toThrow('对话 ID 不能为空')
    await expect(capability('storage.file.get').execute({ fileId: '   ' }, { source: 'agent' })).rejects.toThrow(
      '文件 ID 不能为空'
    )

    expect(mocks.storageV2Service.validateBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getFile).not.toHaveBeenCalled()
  })

  it('rejects invalid storage text input shapes before preparing or calling services', async () => {
    await expect(capability('storage.snapshot.create').execute({ reason: 123 }, { source: 'agent' })).rejects.toThrow(
      '快照原因 必须是字符串'
    )
    await expect(
      capability('storage.backup.create').execute({ reason: { label: 'agent' } }, { source: 'agent' })
    ).rejects.toThrow('备份原因 必须是字符串')
    await expect(
      capability('storage.conversations.list').execute({ ownerType: ['assistant'] }, { source: 'agent' })
    ).rejects.toThrow('归属类型 必须是字符串')
    await expect(
      capability('storage.messages.list').execute({ conversationId: 123 }, { source: 'agent' })
    ).rejects.toThrow('对话 ID 必须是字符串')
    await expect(capability('storage.file.get').execute({ fileId: true }, { source: 'agent' })).rejects.toThrow(
      '文件 ID 必须是字符串'
    )

    expect(mocks.callRendererBridge).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createSnapshot).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listConversations).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getFile).not.toHaveBeenCalled()
  })

  it('rejects invalid storage capability input objects before side effects', async () => {
    await expect(capability('storage.dataRoot.get').execute('root' as any, { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.health.check').execute(['health'] as any, { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.stats.get').execute(false as any, { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(
      capability('storage.backup.create').execute('agent request' as any, { source: 'agent' })
    ).rejects.toThrow('存储能力的输入必须是对象')
    await expect(
      capability('storage.backup.overview').execute(['overview'] as any, { source: 'agent' })
    ).rejects.toThrow('存储能力的输入必须是对象')
    await expect(capability('storage.providers.list').execute('providers' as any, { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.snapshot.create').execute([], { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.assistants.list').execute([], { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.messages.list').execute(['conversation-1'], { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )
    await expect(capability('storage.file.get').execute(true as any, { source: 'agent' })).rejects.toThrow(
      '存储能力的输入必须是对象'
    )

    expect(mocks.callRendererBridge).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getDataRoot).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.healthCheck).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getStats).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createBackup).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getBackupOverview).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.createSnapshot).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listProviders).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listAssistants).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.getFile).not.toHaveBeenCalled()
  })

  it('rejects invalid Storage v2 pagination shapes before calling services', async () => {
    await expect(capability('storage.assistants.list').execute({ limit: true }, { source: 'agent' })).rejects.toThrow(
      '存储列表 limit 必须是数字'
    )
    await expect(
      capability('storage.conversations.list').execute({ offset: { page: 1 } }, { source: 'agent' })
    ).rejects.toThrow('存储列表 offset 必须是数字')
    await expect(
      capability('storage.messages.list').execute(
        { conversationId: 'conversation-1', limit: ['10'] },
        { source: 'agent' }
      )
    ).rejects.toThrow('存储列表 limit 必须是数字')

    expect(mocks.storageV2Service.listAssistants).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listConversations).not.toHaveBeenCalled()
    expect(mocks.storageV2Service.listMessages).not.toHaveBeenCalled()
  })

  it('normalizes file ids before reading Storage v2 file records', async () => {
    await capability('storage.file.get').execute({ fileId: ' file-1 ' }, { source: 'agent' })

    expect(mocks.storageV2Service.getFile).toHaveBeenCalledWith('file-1')
  })
})
