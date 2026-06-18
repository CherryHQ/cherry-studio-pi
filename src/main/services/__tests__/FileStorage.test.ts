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
  storageV2SettingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  },
  browserWindowFromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialogSync: vi.fn(),
  netFetch: vi.fn(),
  chokidarWatch: vi.fn()
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
    writeFileSync: vi.fn(actual.writeFileSync)
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: mocks.browserWindowFromWebContents
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialogSync: mocks.showSaveDialogSync
  },
  net: {
    fetch: mocks.netFetch
  },
  shell: {
    openPath: vi.fn()
  }
}))

vi.mock('chokidar', () => ({
  default: {
    watch: mocks.chokidarWatch
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

vi.mock('@main/utils/language', () => ({
  t: vi.fn((key: string) => key)
}))

vi.mock('../storageV2/StorageV2Repositories', () => ({
  storageV2FileRepository: mocks.storageV2FileRepository,
  storageV2SettingsRepository: mocks.storageV2SettingsRepository
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

function createMockWatcher() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>()
  const watcher = {
    on: vi.fn((eventName: string, handler: (...args: any[]) => void) => {
      handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler])
      return watcher
    }),
    close: vi.fn().mockResolvedValue(undefined)
  }

  return {
    watcher,
    emit(eventName: string, ...args: any[]) {
      for (const handler of handlers.get(eventName) ?? []) {
        handler(...args)
      }
    }
  }
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
    mocks.browserWindowFromWebContents.mockReset()
    mocks.showOpenDialog.mockReset()
    mocks.netFetch.mockReset()
    mocks.chokidarWatch.mockReset()
    mocks.storageV2SettingsRepository.get.mockResolvedValue(null)
    mocks.storageV2SettingsRepository.set.mockResolvedValue({ key: 'minapps.custom' })
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('normalizes custom mini app writes before mirroring them to Storage v2', async () => {
    const { fileStorage } = await import('../FileStorage')

    await fileStorage.writeFileWithId(undefined as never, 'custom-minapps.json', '[{"id":"app-1"}]')

    const filePath = path.join(mocks.dirs.files, 'custom-minapps.json')
    expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify([{ id: 'app-1' }], null, 2))
    expect(mocks.storageV2SettingsRepository.set).toHaveBeenCalledWith('minapps.custom', [{ id: 'app-1' }], 'minapps')
  })

  it('rejects invalid custom mini app writes without corrupting the existing file', async () => {
    const filePath = path.join(mocks.dirs.files, 'custom-minapps.json')
    fs.writeFileSync(filePath, JSON.stringify([{ id: 'existing' }], null, 2))
    const { fileStorage } = await import('../FileStorage')

    await expect(
      fileStorage.writeFileWithId(undefined as never, 'custom-minapps.json', '{"id":"not-array"}')
    ).rejects.toThrow('JSON array')

    expect(fs.readFileSync(filePath, 'utf8')).toBe(JSON.stringify([{ id: 'existing' }], null, 2))
    expect(mocks.storageV2SettingsRepository.set).not.toHaveBeenCalled()
  })

  it('opens folder selection as a child of the invoking window', async () => {
    const parentWindow = { id: 1 }
    const sender = {}
    mocks.browserWindowFromWebContents.mockReturnValueOnce(parentWindow)
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/me/project']
    })

    const { fileStorage } = await import('../FileStorage')
    const selectedPath = await fileStorage.selectFolder({ sender } as never, { title: 'Pick workspace' })

    expect(mocks.browserWindowFromWebContents).toHaveBeenCalledWith(sender)
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      parentWindow,
      expect.objectContaining({
        title: 'Pick workspace',
        properties: ['openDirectory']
      })
    )
    expect(selectedPath).toBe('/Users/me/project')
  })

  it('returns null when folder selection is canceled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: []
    })

    const { fileStorage } = await import('../FileStorage')
    const selectedPath = await fileStorage.selectFolder({ sender: {} } as never)

    expect(selectedPath).toBeNull()
  })

  it('rejects folder selection dialog failures instead of reporting a cancel', async () => {
    mocks.showOpenDialog.mockRejectedValueOnce(new Error('dialog unavailable'))

    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.selectFolder({ sender: {} } as never)).rejects.toThrow('dialog unavailable')
  })

  it('returns null when file open is canceled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: []
    })

    const { fileStorage } = await import('../FileStorage')
    const file = await fileStorage.open(undefined as never, {})

    expect(file).toBeNull()
  })

  it('opens a selected file with content and size', async () => {
    const filePath = path.join(mocks.dirs.root, 'import.json')
    fs.writeFileSync(filePath, '{"ok":true}')
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [filePath]
    })

    const { fileStorage } = await import('../FileStorage')
    const file = await fileStorage.open(undefined as never, {})

    expect(file).toMatchObject({
      fileName: 'import.json',
      filePath,
      size: Buffer.byteLength('{"ok":true}')
    })
    expect(file?.content?.toString()).toBe('{"ok":true}')
  })

  it('rejects file open failures instead of reporting an empty selection', async () => {
    mocks.showOpenDialog.mockRejectedValueOnce(new Error('dialog unavailable'))

    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.open(undefined as never, {})).rejects.toThrow('dialog unavailable')
  })

  it('coalesces repeated recoverable watcher errors into one restart timer', async () => {
    vi.useFakeTimers()
    const firstWatcher = createMockWatcher()
    mocks.chokidarWatch.mockReturnValue(firstWatcher.watcher)
    const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() }
    const { fileStorage } = await import('../FileStorage')

    await fileStorage.startFileWatcher({ sender } as never, mocks.dirs.notes, {
      retryDelayMs: 1000
    })

    firstWatcher.emit('error', new Error('ENOSPC: too many files watched'))
    firstWatcher.emit('error', new Error('EMFILE: too many open files'))

    expect(vi.getTimerCount()).toBe(1)
    expect(mocks.chokidarWatch).toHaveBeenCalledTimes(1)

    await fileStorage.stopFileWatcher()
  })

  it('does not keep the process alive while debouncing file watcher changes', async () => {
    const firstWatcher = createMockWatcher()
    mocks.chokidarWatch.mockReturnValue(firstWatcher.watcher)
    const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() }
    const unref = vi.fn()
    const timer = { unref } as unknown as NodeJS.Timeout
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)

    try {
      const { fileStorage } = await import('../FileStorage')

      await fileStorage.startFileWatcher({ sender } as never, mocks.dirs.notes, {
        debounceMs: 250
      })

      firstWatcher.emit('add', path.join(mocks.dirs.notes, 'draft.md'))

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250)
      expect(unref).toHaveBeenCalledTimes(1)

      await fileStorage.stopFileWatcher()

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    }
  })

  it('cancels a pending watcher restart when the watcher stops', async () => {
    vi.useFakeTimers()
    const firstWatcher = createMockWatcher()
    mocks.chokidarWatch.mockReturnValue(firstWatcher.watcher)
    const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() }
    const { fileStorage } = await import('../FileStorage')

    await fileStorage.startFileWatcher({ sender } as never, mocks.dirs.notes, {
      retryDelayMs: 1000
    })

    firstWatcher.emit('error', new Error('ENOSPC: too many files watched'))
    expect(vi.getTimerCount()).toBe(1)

    await fileStorage.stopFileWatcher()

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.chokidarWatch).toHaveBeenCalledTimes(1)
  })

  it('returns false when image save is canceled', async () => {
    mocks.showSaveDialogSync.mockReturnValueOnce(undefined)
    const mockedFs = await import('fs')

    const { fileStorage } = await import('../FileStorage')
    const saved = await fileStorage.saveImage(undefined as never, 'plot', 'data:image/png;base64,aGVsbG8=')

    expect(saved).toBe(false)
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects image save write failures instead of reporting a cancel', async () => {
    mocks.showSaveDialogSync.mockReturnValueOnce(path.join(mocks.dirs.root, 'plot.png'))
    const mockedFs = await import('fs')
    vi.mocked(mockedFs.writeFileSync).mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    const { fileStorage } = await import('../FileStorage')

    await expect(fileStorage.saveImage(undefined as never, 'plot', 'data:image/png;base64,aGVsbG8=')).rejects.toThrow(
      'disk full'
    )
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
