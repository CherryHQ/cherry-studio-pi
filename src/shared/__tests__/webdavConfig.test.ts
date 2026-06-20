import { describe, expect, it } from 'vitest'

import { normalizeWebDavConfig, normalizeWebDavHost, normalizeWebDavPath, parseWebDavInput } from '../webdavConfig'

describe('webdavConfig', () => {
  it('splits a pasted WebDAV account block into separate fields', () => {
    const input = `http://192.168.1.100:8080/

账号：webdav
密码：test-webdav-password`

    const parsed = parseWebDavInput(input)

    expect(parsed).toMatchObject({
      structured: true,
      webdavHost: 'http://192.168.1.100:8080/',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password'
    })
  })

  it('splits a WebDAV account block after a URL input collapses newlines into spaces', () => {
    const parsed = parseWebDavInput('http://192.168.1.100:8080/ 账号：webdav 密码：test-webdav-password')

    expect(parsed).toMatchObject({
      structured: true,
      webdavHost: 'http://192.168.1.100:8080/',
      webdavUser: 'webdav',
      webdavPass: 'test-webdav-password'
    })
  })

  it('builds a WebDAV URL from provider-style protocol server port and path fields', () => {
    const parsed = parseWebDavInput(`协议：https
服务器地址：openapi.alipan.com
端口：443
路径：/dav
账号：test-webdav-user
密码：secret`)

    expect(parsed).toMatchObject({
      structured: true,
      webdavHost: 'https://openapi.alipan.com:443/dav',
      webdavUser: 'test-webdav-user',
      webdavPass: 'secret'
    })
  })

  it('normalizes URL-embedded credentials into WebDAV auth fields', () => {
    const config = normalizeWebDavConfig(
      {
        webdavHost: 'http://webdav:test-webdav-password@192.168.1.100:8080',
        webdavPath: 'Cherry Studio Pi'
      },
      { requireCredentials: true }
    )

    expect(config.webdavHost).toBe('http://192.168.1.100:8080')
    expect(config.webdavUser).toBe('webdav')
    expect(config.webdavPass).toBe('test-webdav-password')
    expect(config.webdavPath).toBe('/Cherry Studio Pi')
  })

  it('strips URL-embedded credentials when only normalizing the host', () => {
    expect(normalizeWebDavHost('http://webdav:test-webdav-password@192.168.1.100:8080/dav')).toBe(
      'http://192.168.1.100:8080/dav'
    )
    expect(normalizeWebDavHost('webdavs://user:secret@dav.example.com/remote.php/dav')).toBe(
      'https://dav.example.com/remote.php/dav'
    )
  })

  it('normalizes a local single-label host with port when scheme is omitted', () => {
    const config = normalizeWebDavConfig(
      {
        webdavHost: 'nas:8080/dav',
        webdavUser: 'webdav',
        webdavPass: 'test-webdav-password'
      },
      { requireCredentials: true }
    )

    expect(config.webdavHost).toBe('https://nas:8080/dav')
    expect(config.webdavUser).toBe('webdav')
    expect(config.webdavPass).toBe('test-webdav-password')
  })

  it('maps WebDAV URL schemes to HTTP schemes supported by the transport client', () => {
    expect(normalizeWebDavHost('webdav://nas.local:8080/dav')).toBe('http://nas.local:8080/dav')
    expect(normalizeWebDavHost('webdavs://dav.example.com/remote.php/dav')).toBe(
      'https://dav.example.com/remote.php/dav'
    )

    const config = normalizeWebDavConfig(
      {
        webdavHost: 'webdavs://dav.example.com/remote.php/dav',
        webdavUser: 'webdav',
        webdavPass: 'test-webdav-password'
      },
      { requireCredentials: true }
    )

    expect(config.webdavHost).toBe('https://dav.example.com/remote.php/dav')
  })

  it('normalizes remote path dot segments without escaping the WebDAV root', () => {
    expect(normalizeWebDavPath('/team/../Cherry Studio Pi//./sync')).toBe('/Cherry Studio Pi/sync')
    expect(normalizeWebDavPath('../../outside')).toBe('/outside')

    const config = normalizeWebDavConfig(
      {
        webdavHost: 'https://dav.example.com',
        webdavUser: 'webdav',
        webdavPass: 'test-webdav-password',
        webdavPath: '/team/../Cherry Studio Pi//./sync/v1'
      },
      { requireCredentials: true }
    )

    expect(config.webdavPath).toBe('/Cherry Studio Pi/sync/v1')
  })

  it('preserves explicit password bytes while still trimming usernames', () => {
    const config = normalizeWebDavConfig(
      {
        webdavHost: ' https://dav.example.com ',
        webdavUser: ' webdav ',
        webdavPass: ' secret-with-significant-spaces '
      },
      { requireCredentials: true }
    )

    expect(config.webdavHost).toBe('https://dav.example.com')
    expect(config.webdavUser).toBe('webdav')
    expect(config.webdavPass).toBe(' secret-with-significant-spaces ')
  })

  it('strips encoded line-break credential tails from the URL before requests are built', () => {
    const config = normalizeWebDavConfig(
      {
        webdavHost:
          'http://192.168.1.100:8080/%0A%0A%E8%B4%A6%E5%8F%B7%EF%BC%9Awebdav%0A%E5%AF%86%E7%A0%81%EF%BC%9Atest-webdav-password',
        webdavUser: 'webdav',
        webdavPass: 'test-webdav-password'
      },
      { requireCredentials: true }
    )

    expect(config.webdavHost).toBe('http://192.168.1.100:8080')
    expect(config.webdavUser).toBe('webdav')
    expect(config.webdavPass).toBe('test-webdav-password')
  })

  it('rejects data sync WebDAV config without credentials before anonymous requests are sent', () => {
    expect(() =>
      normalizeWebDavConfig(
        {
          webdavHost: 'http://192.168.1.100:8080',
          webdavUser: '',
          webdavPass: ''
        },
        { requireCredentials: true }
      )
    ).toThrow('WebDAV 用户名和密码不能为空')
  })
})
