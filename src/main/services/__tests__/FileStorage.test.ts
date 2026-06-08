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
  },
  netFetch: vi.fn()
}))

let fs: typeof NodeFs

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('fs')

  return {
    default: actual,
    createWriteStream: vi.fn(actual.createWriteStream),
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
  net: {
    fetch: mocks.netFetch
  },
  shell: {
    openPath: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((name: string) => {
      if (name === 'feature.files.data') return mocks.dirs.files
      if (name === 'feature.notes.data') return mocks.dirs.notes
      if (name === 'app.temp') return mocks.dirs.temp
      return path.join(mocks.dirs.root, name)
    })
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

function mockDownloadResponse(body: string, headers: Record<string, string> = {}, ok = true, status = 200): Response {
  const bytes = new TextEncoder().encode(body)

  return {
    ok,
    status,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      }
    })
  } as Response
}

function mockOversizedDownloadStreamResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'text/plain' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue({ byteLength: 101 * 1024 * 1024 } as unknown as Uint8Array<ArrayBuffer>)
      }
    })
  } as Response
}

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
    fs.mkdirSync(mocks.dirs.files, { recursive: true })
    fs.mkdirSync(mocks.dirs.notes, { recursive: true })
    fs.mkdirSync(mocks.dirs.temp, { recursive: true })
    mocks.storageV2FileRepository.importFile.mockResolvedValue({ imported: true })
    mocks.netFetch.mockReset()
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

  it('rejects stored file names that would escape the Files directory', async () => {
    const outsidePath = path.join(mocks.dirs.root, 'outside.txt')
    fs.writeFileSync(outsidePath, 'outside')

    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.readFile(undefined as never, '../outside.txt')).rejects.toThrow('Unsafe stored file name')
    await expect(fileStorage.writeFileWithId(undefined as never, '../outside.txt', 'changed')).rejects.toThrow(
      'Unsafe stored file name'
    )
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('outside')
  })

  it('rejects private remote download URLs before the main process fetches them', async () => {
    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.downloadFile(undefined as never, 'http://127.0.0.1:8080/secret.txt')).rejects.toThrow(
      'Unsafe remote url'
    )

    expect(mocks.netFetch).not.toHaveBeenCalled()
    expect(fs.readdirSync(mocks.dirs.files)).toEqual([])
  })

  it('rejects oversized remote downloads before writing a stored file', async () => {
    mocks.netFetch.mockResolvedValue(
      mockDownloadResponse('', { 'Content-Length': String(101 * 1024 * 1024), 'Content-Type': 'text/plain' })
    )

    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.downloadFile(undefined as never, 'https://example.com/huge.txt')).rejects.toThrow(
      'Remote file is too large'
    )

    expect(mocks.netFetch).toHaveBeenCalledWith(
      'https://example.com/huge.txt',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(fs.readdirSync(mocks.dirs.files)).toEqual([])
  })

  it('rejects oversized remote download streams without leaving a partial stored file', async () => {
    mocks.netFetch.mockResolvedValue(mockOversizedDownloadStreamResponse())

    const { fileStorage } = await import('../FileStorage')

    await expect(
      fileStorage.downloadFile(undefined as never, 'https://example.com/streaming-huge.txt')
    ).rejects.toThrow('Remote file is too large')

    expect(fs.readdirSync(mocks.dirs.files)).toEqual([])
  })
})
