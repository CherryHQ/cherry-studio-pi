import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
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
        password: 'test-webdav-password'
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
})
