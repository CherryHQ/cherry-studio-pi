import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  client: {
    exists: vi.fn(),
    createDirectory: vi.fn(),
    putFileContents: vi.fn(),
    getFileContents: vi.fn(),
    getDirectoryContents: vi.fn(),
    deleteFile: vi.fn()
  },
  createClient: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('webdav', () => ({
  createClient: mocks.createClient
}))

import { createClient } from 'webdav'

import WebDav from '../WebDav'

describe('WebDav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockReturnValue(mocks.client)
  })

  it('passes a clean host and credentials separately to the WebDAV client', () => {
    new WebDav({
      webdavHost:
        'http://192.168.1.100:8080/%0A%0A%E8%B4%A6%E5%8F%B7%EF%BC%9Awebdav%0A%E5%AF%86%E7%A0%81%EF%BC%9Atest-webdav-password',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password'
    })

    expect(createClient).toHaveBeenCalledWith(
      'http://192.168.1.100:8080',
      expect.objectContaining({
        username: 'webdav',
        password: 'test-webdav-password',
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object)
      })
    )
  })

  it('rejects missing credentials before creating an anonymous WebDAV client', () => {
    expect(() => new WebDav({ webdavHost: 'http://192.168.1.100:8080' })).toThrow('WebDAV 用户名和密码不能为空')

    expect(createClient).not.toHaveBeenCalled()
  })

  it('throws instead of returning an Error object when upload is called without an initialized client', async () => {
    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password'
    })
    webdav.instance = undefined

    await expect(webdav.putFileContents('backup.zip', 'data')).rejects.toThrow('WebDAV client not initialized')
  })

  it('creates nested parent directories before uploading files', async () => {
    mocks.client.exists.mockResolvedValueOnce(false)
    mocks.client.createDirectory.mockResolvedValueOnce(true)
    mocks.client.putFileContents.mockResolvedValueOnce(true)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.putFileContents('snapshots/2026/backup.zip', 'data', { overwrite: true })).resolves.toBe(true)

    expect(mocks.client.exists).toHaveBeenCalledWith('/Cherry Studio Pi/snapshots/2026')
    expect(mocks.client.createDirectory).toHaveBeenCalledWith('/Cherry Studio Pi/snapshots/2026', { recursive: true })
    expect(mocks.client.putFileContents).toHaveBeenCalledWith('/Cherry Studio Pi/snapshots/2026/backup.zip', 'data', {
      overwrite: true
    })
  })

  it('continues uploading when another client creates the parent directory concurrently', async () => {
    mocks.client.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mocks.client.createDirectory.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
    mocks.client.putFileContents.mockResolvedValueOnce(true)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.putFileContents('snapshots/2026/backup.zip', 'data')).resolves.toBe(true)

    expect(mocks.client.exists).toHaveBeenNthCalledWith(1, '/Cherry Studio Pi/snapshots/2026')
    expect(mocks.client.createDirectory).toHaveBeenCalledWith('/Cherry Studio Pi/snapshots/2026', {
      recursive: true
    })
    expect(mocks.client.exists).toHaveBeenNthCalledWith(2, '/Cherry Studio Pi/snapshots/2026')
    expect(mocks.client.putFileContents).toHaveBeenCalledWith(
      '/Cherry Studio Pi/snapshots/2026/backup.zip',
      'data',
      undefined
    )
  })

  it('keeps failing uploads when parent directory creation fails and the directory is still missing', async () => {
    mocks.client.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    mocks.client.createDirectory.mockRejectedValueOnce(Object.assign(new Error('Precondition Failed'), { status: 412 }))

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.putFileContents('snapshots/2026/backup.zip', 'data')).rejects.toThrow('Precondition Failed')

    expect(mocks.client.exists).toHaveBeenNthCalledWith(1, '/Cherry Studio Pi/snapshots/2026')
    expect(mocks.client.createDirectory).toHaveBeenCalledWith('/Cherry Studio Pi/snapshots/2026', {
      recursive: true
    })
    expect(mocks.client.exists).toHaveBeenNthCalledWith(2, '/Cherry Studio Pi/snapshots/2026')
    expect(mocks.client.putFileContents).not.toHaveBeenCalled()
  })

  it('still creates the configured WebDAV directory before uploading root-level files', async () => {
    mocks.client.exists.mockResolvedValueOnce(false)
    mocks.client.createDirectory.mockResolvedValueOnce(true)
    mocks.client.putFileContents.mockResolvedValueOnce(true)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.putFileContents('backup.zip', 'data')).resolves.toBe(true)

    expect(mocks.client.exists).toHaveBeenCalledWith('/Cherry Studio Pi')
    expect(mocks.client.createDirectory).toHaveBeenCalledWith('/Cherry Studio Pi', { recursive: true })
    expect(mocks.client.putFileContents).toHaveBeenCalledWith('/Cherry Studio Pi/backup.zip', 'data', undefined)
  })

  it('rejects remote file paths outside the configured WebDAV directory', async () => {
    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.putFileContents('../backup.zip', 'data')).rejects.toThrow(
      'WebDAV file path is outside the configured directory'
    )
    await expect(webdav.getFileContents('../backup.zip')).rejects.toThrow(
      'WebDAV file path is outside the configured directory'
    )
    await expect(webdav.deleteFile('../backup.zip')).rejects.toThrow(
      'WebDAV file path is outside the configured directory'
    )

    expect(mocks.client.exists).not.toHaveBeenCalled()
    expect(mocks.client.createDirectory).not.toHaveBeenCalled()
    expect(mocks.client.putFileContents).not.toHaveBeenCalled()
    expect(mocks.client.getFileContents).not.toHaveBeenCalled()
    expect(mocks.client.deleteFile).not.toHaveBeenCalled()
  })

  it('keeps explicit directory creation inside the configured WebDAV directory', async () => {
    mocks.client.createDirectory.mockResolvedValue(true)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.createDirectory('manual/nested', { recursive: true })).resolves.toBe(true)
    await expect(webdav.createDirectory('/Cherry Studio Pi/manual/absolute', { recursive: true })).resolves.toBe(true)
    await expect(webdav.createDirectory('/Other App/manual', { recursive: true })).rejects.toThrow(
      'WebDAV directory path is outside the configured directory'
    )

    expect(mocks.client.createDirectory).toHaveBeenNthCalledWith(1, '/Cherry Studio Pi/manual/nested', {
      recursive: true
    })
    expect(mocks.client.createDirectory).toHaveBeenNthCalledWith(2, '/Cherry Studio Pi/manual/absolute', {
      recursive: true
    })
    expect(mocks.client.createDirectory).toHaveBeenCalledTimes(2)
  })

  it('checks and creates the configured WebDAV directory instead of probing the server root', async () => {
    mocks.client.exists.mockResolvedValueOnce(false)
    mocks.client.createDirectory.mockResolvedValueOnce(true)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.checkConnection()).resolves.toBe(true)

    expect(mocks.client.exists).toHaveBeenCalledWith('/Cherry Studio Pi')
    expect(mocks.client.exists).not.toHaveBeenCalledWith('/')
    expect(mocks.client.createDirectory).toHaveBeenCalledWith('/Cherry Studio Pi', { recursive: true })
  })

  it('returns an empty listing when the configured WebDAV backup directory does not exist yet', async () => {
    mocks.client.exists.mockResolvedValueOnce(false)

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.getDirectoryContents()).resolves.toEqual([])

    expect(mocks.client.exists).toHaveBeenCalledWith('/Cherry Studio Pi')
    expect(mocks.client.getDirectoryContents).not.toHaveBeenCalled()
  })

  it('returns an empty listing when the configured WebDAV backup directory disappears before listing', async () => {
    mocks.client.exists.mockResolvedValueOnce(true)
    mocks.client.getDirectoryContents.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))

    const webdav = new WebDav({
      webdavHost: 'http://192.168.1.100:8080',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password',
      webdavPath: '/Cherry Studio Pi'
    })

    await expect(webdav.getDirectoryContents()).resolves.toEqual([])

    expect(mocks.client.exists).toHaveBeenCalledWith('/Cherry Studio Pi')
    expect(mocks.client.getDirectoryContents).toHaveBeenCalledWith('/Cherry Studio Pi')
  })
})
