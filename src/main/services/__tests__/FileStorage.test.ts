import path from 'node:path'

import type * as NodeFs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dirs: {
    root: '',
    files: '',
    notes: '',
    temp: ''
  },
  storageV2FileRepository: {
    importFile: vi.fn()
  }
}))

let fs: typeof NodeFs

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('fs')

  return {
    default: actual,
    promises: actual.promises,
    createReadStream: vi.fn(actual.createReadStream),
    existsSync: actual.existsSync,
    mkdirSync: actual.mkdirSync,
    mkdtempSync: actual.mkdtempSync,
    readFileSync: actual.readFileSync,
    readdirSync: actual.readdirSync,
    rmSync: actual.rmSync,
    statSync: actual.statSync,
    writeFileSync: actual.writeFileSync
  }
})

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  },
  net: {},
  shell: {
    openPath: vi.fn()
  }
}))

vi.mock('@main/utils/file', () => ({
  checkName: vi.fn((name: string) => name),
  getFilesDir: () => mocks.dirs.files,
  getFileType: vi.fn(() => 'text'),
  getName: vi.fn((filePath: string) => path.basename(filePath, path.extname(filePath))),
  getNotesDir: () => mocks.dirs.notes,
  getTempDir: () => mocks.dirs.temp,
  readTextFileWithAutoEncoding: vi.fn(),
  scanDir: vi.fn()
}))

vi.mock('../storageV2/StorageV2Repositories', () => ({
  storageV2FileRepository: mocks.storageV2FileRepository
}))

describe('FileStorage Storage v2 upload flow', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    fs = await vi.importActual<typeof NodeFs>('fs')
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'file-storage-v2-'))
    mocks.dirs.root = root
    mocks.dirs.files = path.join(root, 'Files')
    mocks.dirs.notes = path.join(root, 'Notes')
    mocks.dirs.temp = path.join(root, 'Temp')
    mocks.storageV2FileRepository.importFile.mockResolvedValue({ imported: true })
  })

  afterEach(() => {
    fs.rmSync(mocks.dirs.root, { recursive: true, force: true })
  })

  it('imports the processed upload into Storage v2 before writing the final legacy file', async () => {
    const sourcePath = path.join(mocks.dirs.root, 'source.txt')
    fs.writeFileSync(sourcePath, 'hello storage v2')

    mocks.storageV2FileRepository.importFile.mockImplementation(async (file) => {
      expect(file.path).toMatch(`${path.sep}Files${path.sep}`)
      expect(file.storageV2SourcePath).toMatch(`${path.sep}Temp${path.sep}file-uploads${path.sep}`)
      expect(fs.existsSync(file.storageV2SourcePath)).toBe(true)
      expect(fs.existsSync(file.path)).toBe(false)
      return { imported: true }
    })

    const { fileStorage } = await import('../FileStorage')

    const result = await fileStorage.uploadFile(undefined as never, {
      id: 'source',
      name: 'source.txt',
      origin_name: 'source.txt',
      path: sourcePath,
      size: 0,
      ext: '.txt',
      type: 'text',
      created_at: new Date().toISOString(),
      count: 1
    })

    expect(fs.readFileSync(result.path, 'utf8')).toBe('hello storage v2')
    expect(fs.existsSync(path.join(mocks.dirs.temp, 'file-uploads', result.name))).toBe(false)
    expect(mocks.storageV2FileRepository.importFile).toHaveBeenCalledTimes(1)
  })

  it('does not write the legacy file when Storage v2 import fails', async () => {
    const sourcePath = path.join(mocks.dirs.root, 'source.txt')
    fs.writeFileSync(sourcePath, 'hello storage v2')
    mocks.storageV2FileRepository.importFile.mockRejectedValue(new Error('storage locked'))

    const { fileStorage } = await import('../FileStorage')

    await expect(
      fileStorage.uploadFile(undefined as never, {
        id: 'source',
        name: 'source.txt',
        origin_name: 'source.txt',
        path: sourcePath,
        size: 0,
        ext: '.txt',
        type: 'text',
        created_at: new Date().toISOString(),
        count: 1
      })
    ).rejects.toThrow('storage locked')

    expect(fs.readdirSync(mocks.dirs.files)).toEqual([])
  })

  it('reuses the uploaded file hash while scanning same-size duplicate candidates', async () => {
    const sourcePath = path.join(mocks.dirs.root, 'source.txt')
    fs.writeFileSync(sourcePath, 'same content')

    const { fileStorage } = await import('../FileStorage')
    fs.writeFileSync(path.join(mocks.dirs.files, 'a.txt'), 'other bytes!')
    fs.writeFileSync(path.join(mocks.dirs.files, 'b.txt'), 'same content')

    const mockedFs = await import('fs')
    vi.mocked(mockedFs.createReadStream).mockClear()

    const result = await fileStorage.uploadFile(undefined as never, {
      id: 'source',
      name: 'source.txt',
      origin_name: 'source.txt',
      path: sourcePath,
      size: 0,
      ext: '.txt',
      type: 'text',
      created_at: new Date().toISOString(),
      count: 1
    })

    const sourceHashReads = vi
      .mocked(mockedFs.createReadStream)
      .mock.calls.filter(([candidatePath]) => String(candidatePath) === sourcePath)

    expect(sourceHashReads).toHaveLength(1)
    expect(result).toMatchObject({
      id: 'b',
      name: 'b.txt',
      path: path.join(mocks.dirs.files, 'b.txt'),
      count: 2
    })
    expect(mocks.storageV2FileRepository.importFile).toHaveBeenCalledTimes(1)
  })

  it('cleans pasted image temp files when compression falls back to the original buffer', async () => {
    const { fileStorage } = await import('../FileStorage')
    const compressImageSpy = vi
      .spyOn(fileStorage as unknown as { compressImage: () => Promise<void> }, 'compressImage')
      .mockRejectedValueOnce(new Error('compress failed'))

    const result = await fileStorage.savePastedImage(undefined as never, Buffer.alloc(1024 * 1024 + 1), '.png')

    expect(fs.existsSync(result.path)).toBe(true)
    expect(fs.readdirSync(mocks.dirs.temp)).toEqual([])

    compressImageSpy.mockRestore()
  })

  it.each(['../../outside.txt', '..\\..\\outside.txt', '/tmp/outside.txt', 'C:\\Users\\me\\outside.txt'])(
    'keeps temp files inside the app temp directory for unsafe name %s',
    async (fileName) => {
      const { fileStorage } = await import('../FileStorage')

      const tempPath = await fileStorage.createTempFile(undefined as never, fileName)

      expect(path.dirname(tempPath)).toBe(mocks.dirs.temp)
      expect(path.basename(tempPath)).toMatch(/^temp_file_[\w-]+_outside\.txt$/)
    }
  )
})
