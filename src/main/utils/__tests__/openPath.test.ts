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

  it('logs asynchronous open failures for fire-and-forget callers', async () => {
    mocks.openPath.mockResolvedValueOnce('File does not exist.')
    openPathInShellAndLog('/tmp/missing.txt', 'test path')
    await vi.waitFor(() => expect(mocks.logger.warn).toHaveBeenCalled())
  })
})
