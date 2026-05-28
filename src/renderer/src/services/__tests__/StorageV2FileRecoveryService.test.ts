import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  filesBulkPut: vi.fn(),
  filesCount: vi.fn(),
  filesGet: vi.fn(),
  filesOrderBy: vi.fn(),
  filesPut: vi.fn(),
  filesWhere: vi.fn(),
  filesToArray: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      bulkPut: mocks.filesBulkPut,
      count: mocks.filesCount,
      get: mocks.filesGet,
      orderBy: mocks.filesOrderBy,
      put: mocks.filesPut,
      where: mocks.filesWhere
    }
  }
}))

describe('StorageV2FileRecoveryService', () => {
  let originalApi: unknown

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalApi = window.api
    mocks.filesOrderBy.mockReturnValue({ toArray: mocks.filesToArray })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('projects Storage v2 files and blobs when the legacy file table is empty', async () => {
    const file = {
      id: 'file-1',
      name: 'file-1.txt',
      origin_name: 'notes.txt',
      path: '',
      size: 128,
      ext: '.txt',
      type: 'text',
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }
    const listFiles = vi.fn().mockResolvedValue([file])
    const projectFilesToLegacyRuntime = vi.fn().mockResolvedValue({ projectedFileCount: 1 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getFile: vi.fn(),
          listFiles,
          projectFilesToLegacyRuntime
        }
      }
    })
    mocks.filesCount.mockResolvedValue(0)

    const { storageV2FileRecoveryService } = await import('../StorageV2FileRecoveryService')

    await expect(storageV2FileRecoveryService.projectFilesIfEmpty('files-page-empty')).resolves.toBe(true)
    expect(listFiles).toHaveBeenCalled()
    expect(projectFilesToLegacyRuntime).toHaveBeenCalled()
    expect(mocks.filesBulkPut).toHaveBeenCalledWith([file])
  })

  it('projects a single missing file from Storage v2', async () => {
    const file = {
      id: 'file-1',
      name: 'file-1.txt',
      origin_name: 'notes.txt',
      path: '',
      size: 128,
      ext: '.txt',
      type: 'text',
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }
    const getFile = vi.fn().mockResolvedValue(file)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getFile,
          listFiles: vi.fn(),
          projectFilesToLegacyRuntime: vi.fn()
        }
      }
    })
    mocks.filesGet.mockResolvedValue(undefined)

    const { storageV2FileRecoveryService } = await import('../StorageV2FileRecoveryService')

    await expect(storageV2FileRecoveryService.projectFileIfMissing('file-1', 'file-manager-get-missing')).resolves.toBe(
      true
    )
    expect(getFile).toHaveBeenCalledWith('file-1')
    expect(mocks.filesPut).toHaveBeenCalledWith(file)
  })

  it('reuses an in-flight full file projection', async () => {
    const file = {
      id: 'file-1',
      name: 'file-1.txt',
      origin_name: 'notes.txt',
      path: '',
      size: 128,
      ext: '.txt',
      type: 'text',
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }
    let resolveListFiles: (files: unknown[]) => void = () => undefined
    const listFiles = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveListFiles = resolve
        })
    )
    const projectFilesToLegacyRuntime = vi.fn().mockResolvedValue({ projectedFileCount: 1 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageV2: {
          getFile: vi.fn(),
          listFiles,
          projectFilesToLegacyRuntime
        }
      }
    })
    mocks.filesCount.mockResolvedValue(0)

    const { storageV2FileRecoveryService } = await import('../StorageV2FileRecoveryService')

    const firstProjection = storageV2FileRecoveryService.projectFilesIfEmpty('files-page-empty')
    const secondProjection = storageV2FileRecoveryService.projectFilesIfEmpty('files-page-empty')
    await vi.waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1))
    resolveListFiles([file])

    await expect(Promise.all([firstProjection, secondProjection])).resolves.toEqual([true, true])
    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(projectFilesToLegacyRuntime).toHaveBeenCalledTimes(1)
  })
})
