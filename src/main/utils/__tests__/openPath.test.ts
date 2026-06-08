import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  logger: {
    warn: vi.fn()
  }
}))

vi.mock('electron', () => ({
  shell: {
    openPath: mocks.openPath
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

const { openPathInShell, openPathInShellAndLog } = await import('../openPath')

describe('openPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openPath.mockResolvedValue('')
  })

  it('treats an empty shell.openPath result as success', async () => {
    await expect(openPathInShell('/tmp/file.txt')).resolves.toBeUndefined()
    expect(mocks.openPath).toHaveBeenCalledWith('/tmp/file.txt')
  })

  it('throws when shell.openPath returns an error message', async () => {
    mocks.openPath.mockResolvedValueOnce('No application is associated with this file.')

    await expect(openPathInShell('/tmp/file.unknown')).rejects.toThrow('No application is associated')
  })

  it('rejects URL schemes before passing them to the OS shell', async () => {
    await expect(openPathInShell('https://example.com/download')).rejects.toThrow('URL schemes are not allowed')
    await expect(openPathInShell('file:///Users/me/secrets.txt')).rejects.toThrow('URL schemes are not allowed')

    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it('rejects empty and NUL-containing paths before passing them to the OS shell', async () => {
    await expect(openPathInShell('   ')).rejects.toThrow('empty path')
    await expect(openPathInShell('/tmp/file.txt\0.jpg')).rejects.toThrow('NUL bytes')

    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it('keeps Windows drive-letter paths valid', async () => {
    await expect(openPathInShell('C:\\Users\\me\\file.txt')).resolves.toBeUndefined()

    expect(mocks.openPath).toHaveBeenCalledWith('C:\\Users\\me\\file.txt')
  })

  it('logs asynchronous open failures for fire-and-forget callers', async () => {
    mocks.openPath.mockResolvedValueOnce('File does not exist.')
    openPathInShellAndLog('/tmp/missing.txt', 'test path')
    await vi.waitFor(() => expect(mocks.logger.warn).toHaveBeenCalled())
  })
})
