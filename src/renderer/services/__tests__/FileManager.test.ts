import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  filesAdd: vi.fn(),
  filesDelete: vi.fn(),
  filesGet: vi.fn(),
  filesUpdate: vi.fn(),
  localBase64File: vi.fn(),
  localFileDelete: vi.fn(),
  localFileUpload: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  },
  mirrorFlush: vi.fn(),
  mirrorScheduleFile: vi.fn(),
  storageV2DeleteFile: vi.fn(),
  storageV2UpsertFile: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      add: mocks.filesAdd,
      delete: mocks.filesDelete,
      get: mocks.filesGet,
      update: mocks.filesUpdate
    }
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      runtime: {
        filesPath: '/mock/files'
      }
    })
  }
}))

vi.mock('@renderer/services/StorageV2FileRecoveryService', () => ({
  storageV2FileRecoveryService: {
    projectFileIfMissing: vi.fn(),
    projectMissingFiles: vi.fn()
  }
}))

vi.mock('@renderer/services/StorageV2FileMirrorService', () => ({
  storageV2FileMirrorService: {
    flush: mocks.mirrorFlush,
    scheduleFile: mocks.mirrorScheduleFile
  }
}))

describe('FileManager', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          base64File: mocks.localBase64File,
          delete: mocks.localFileDelete,
          upload: mocks.localFileUpload
        },
        storageV2: {
          deleteFile: mocks.storageV2DeleteFile,
          upsertFile: mocks.storageV2UpsertFile
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('stops deleting file metadata when the Storage v2 tombstone fails', async () => {
    const error = new Error('storage unavailable')
    mocks.filesGet.mockResolvedValue({
      id: 'file-1',
      ext: '.txt',
      count: 1,
      origin_name: 'note.txt'
    })
    mocks.storageV2DeleteFile.mockRejectedValue(error)

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.deleteFile('file-1', true)).rejects.toThrow(error)

    expect(mocks.storageV2DeleteFile).toHaveBeenCalledWith('file-1')
    expect(mocks.filesDelete).not.toHaveBeenCalled()
    expect(mocks.localFileDelete).not.toHaveBeenCalled()
  })

  it('stops deleting file metadata when the Storage v2 tombstone API is unavailable', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          delete: mocks.localFileDelete
        },
        storageV2: {}
      }
    })
    mocks.filesGet.mockResolvedValue({
      id: 'file-1',
      ext: '.txt',
      count: 1,
      origin_name: 'note.txt'
    })

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.deleteFile('file-1', true)).rejects.toThrow('Storage v2 file delete API unavailable')

    expect(mocks.filesDelete).not.toHaveBeenCalled()
    expect(mocks.localFileDelete).not.toHaveBeenCalled()
  })

  it('deletes legacy metadata and the local file after the Storage v2 tombstone succeeds', async () => {
    mocks.filesGet.mockResolvedValue({
      id: 'file-1',
      ext: '.txt',
      count: 1,
      origin_name: 'note.txt'
    })
    mocks.storageV2DeleteFile.mockResolvedValue({ deleted: true })
    mocks.filesDelete.mockResolvedValue(undefined)
    mocks.localFileDelete.mockResolvedValue(undefined)

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.deleteFile('file-1', true)).resolves.toBeUndefined()

    expect(mocks.storageV2DeleteFile).toHaveBeenCalledWith('file-1')
    expect(mocks.filesDelete).toHaveBeenCalledWith('file-1')
    expect(mocks.localFileDelete).toHaveBeenCalledWith('file-1.txt')
  })

  it('rejects batch deletion when any Storage v2 file tombstone fails', async () => {
    mocks.filesGet.mockImplementation(async (id: string) => ({
      id,
      ext: '.txt',
      count: 1,
      origin_name: `${id}.txt`
    }))
    mocks.storageV2DeleteFile.mockImplementation(async (id: string) => {
      if (id === 'file-2') {
        throw new Error('storage unavailable')
      }
      return { deleted: true }
    })
    mocks.filesDelete.mockResolvedValue(undefined)
    mocks.localFileDelete.mockResolvedValue(undefined)

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.deleteFiles([{ id: 'file-1' }, { id: 'file-2' }] as any)).rejects.toThrow(
      'Failed to delete 1 file(s)'
    )

    expect(mocks.storageV2DeleteFile).toHaveBeenCalledWith('file-1')
    expect(mocks.storageV2DeleteFile).toHaveBeenCalledWith('file-2')
    expect(mocks.filesDelete).toHaveBeenCalledWith('file-1')
    expect(mocks.filesDelete).not.toHaveBeenCalledWith('file-2')
  })

  it('upserts file metadata before adding legacy metadata', async () => {
    const file = {
      id: 'file-2',
      ext: '.txt',
      count: 1,
      origin_name: 'draft.txt'
    }
    mocks.filesGet.mockResolvedValue(undefined)
    mocks.filesAdd.mockResolvedValue('file-2')
    mocks.storageV2UpsertFile.mockResolvedValue({ id: 'file-2' })

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.addFile(file as any)).resolves.toBe(file)

    expect(mocks.storageV2UpsertFile).toHaveBeenCalledWith(file)
    expect(mocks.filesAdd).toHaveBeenCalledWith(file)
    expect(mocks.storageV2UpsertFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.filesAdd.mock.invocationCallOrder[0]
    )
  })

  it('logs only file summaries when adding base64 files', async () => {
    const sourceFile = {
      id: 'file-base64',
      name: 'image.png',
      origin_name: 'image.png',
      path: '/private/user/image.png',
      size: 1024,
      ext: '.png',
      type: 'image',
      count: 1,
      data: 'RAW_BASE64_PAYLOAD_SHOULD_NOT_LOG'
    }
    const storedFile = {
      ...sourceFile,
      id: 'file-base64-stored',
      path: '/private/user/stored-image.png',
      data: 'STORED_BASE64_PAYLOAD_SHOULD_NOT_LOG'
    }
    mocks.localBase64File.mockResolvedValue(storedFile)
    mocks.filesGet.mockResolvedValue(undefined)
    mocks.filesAdd.mockResolvedValue('file-base64-stored')
    mocks.storageV2UpsertFile.mockResolvedValue({ id: 'file-base64-stored' })

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.addBase64File(sourceFile as any)).resolves.toBe(storedFile)

    expect(mocks.localBase64File).toHaveBeenCalledWith('file-base64.png')
    expect(mocks.storageV2UpsertFile).toHaveBeenCalledWith(storedFile)
    expect(mocks.logger.info).toHaveBeenCalledWith('Adding base64 file', {
      id: 'file-base64',
      name: 'image.png',
      origin_name: 'image.png',
      size: 1024,
      ext: '.png',
      type: 'image',
      count: 1,
      tokens: undefined,
      purpose: undefined
    })

    const logged = JSON.stringify(mocks.logger.info.mock.calls)
    expect(logged).not.toContain('RAW_BASE64_PAYLOAD_SHOULD_NOT_LOG')
    expect(logged).not.toContain('STORED_BASE64_PAYLOAD_SHOULD_NOT_LOG')
    expect(logged).not.toContain('/private/user')
  })

  it('logs only file summaries when uploading files', async () => {
    const sourceFile = {
      id: 'file-upload',
      name: 'draft.txt',
      origin_name: 'draft.txt',
      path: '/private/user/draft.txt',
      size: 2048,
      ext: '.txt',
      type: 'text',
      count: 1,
      data: 'RAW_UPLOAD_PAYLOAD_SHOULD_NOT_LOG'
    }
    const uploadedFile = {
      ...sourceFile,
      id: 'file-uploaded',
      path: '/private/user/uploaded-draft.txt',
      data: 'UPLOADED_PAYLOAD_SHOULD_NOT_LOG'
    }
    mocks.localFileUpload.mockResolvedValue(uploadedFile)
    mocks.filesGet.mockResolvedValue(undefined)
    mocks.filesAdd.mockResolvedValue('file-uploaded')
    mocks.storageV2UpsertFile.mockResolvedValue({ id: 'file-uploaded' })

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.uploadFile(sourceFile as any)).resolves.toBe(uploadedFile)

    expect(mocks.localFileUpload).toHaveBeenCalledWith(sourceFile)
    expect(mocks.storageV2UpsertFile).toHaveBeenCalledWith(uploadedFile)
    expect(mocks.logger.info).toHaveBeenCalledWith('Uploading file', {
      id: 'file-upload',
      name: 'draft.txt',
      origin_name: 'draft.txt',
      size: 2048,
      ext: '.txt',
      type: 'text',
      count: 1,
      tokens: undefined,
      purpose: undefined
    })
    expect(mocks.logger.info).toHaveBeenCalledWith('Uploaded file', {
      id: 'file-uploaded',
      name: 'draft.txt',
      origin_name: 'draft.txt',
      size: 2048,
      ext: '.txt',
      type: 'text',
      count: 1,
      tokens: undefined,
      purpose: undefined
    })

    const logged = JSON.stringify(mocks.logger.info.mock.calls)
    expect(logged).not.toContain('RAW_UPLOAD_PAYLOAD_SHOULD_NOT_LOG')
    expect(logged).not.toContain('UPLOADED_PAYLOAD_SHOULD_NOT_LOG')
    expect(logged).not.toContain('/private/user')
  })

  it('stops adding legacy metadata when the Storage v2 file upsert fails', async () => {
    const file = {
      id: 'file-2',
      ext: '.txt',
      count: 1,
      origin_name: 'draft.txt'
    }
    mocks.filesGet.mockResolvedValue(undefined)
    mocks.storageV2UpsertFile.mockRejectedValue(new Error('temporary storage failure'))

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.addFile(file as any)).rejects.toThrow('temporary storage failure')

    expect(mocks.storageV2UpsertFile).toHaveBeenCalledWith(file)
    expect(mocks.filesAdd).not.toHaveBeenCalled()
  })

  it('stops adding legacy metadata when Storage v2 is unavailable during add', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          delete: mocks.localFileDelete
        }
      }
    })
    const file = {
      id: 'file-3',
      ext: '.txt',
      count: 1,
      origin_name: 'offline.txt'
    }
    mocks.filesGet.mockResolvedValue(undefined)
    mocks.filesAdd.mockResolvedValue('file-3')

    const { default: FileManager } = await import('../FileManager')

    await expect(FileManager.addFile(file as any)).rejects.toThrow('Storage v2 file upsert API unavailable')

    expect(mocks.filesAdd).not.toHaveBeenCalled()
    expect(mocks.storageV2UpsertFile).not.toHaveBeenCalled()
  })
})
