import { describe, expect, it } from 'vitest'

import { describeWebDavUserFacingError, normalizeWebDavHost, WebDavOperationError } from '../WebDavRetry'

describe('WebDavRetry', () => {
  it('normalizes WebDAV hosts without a protocol', () => {
    expect(normalizeWebDavHost('dav.example.com/remote.php/dav')).toBe('https://dav.example.com/remote.php/dav')
    expect(normalizeWebDavHost('https://dav.example.com')).toBe('https://dav.example.com')
  })

  it('describes temporary service failures in actionable Chinese', () => {
    const error = new WebDavOperationError(
      'listing remote directory /',
      new Error('Invalid response: 503 Service Unavailable')
    )

    expect(describeWebDavUserFacingError(error, '读取远程目录')).toContain('WebDAV 服务暂时不可用')
    expect(describeWebDavUserFacingError(error, '读取远程目录')).toContain('软件已经自动重试')
  })

  it('includes the blocked WebDAV path for permission failures', () => {
    const error = new WebDavOperationError(
      'writing remote sync probe /remote-root/sync/v1/.cherry-studio-pi-write-test.tmp',
      new Error('Invalid response: 403 Forbidden')
    )

    const message = describeWebDavUserFacingError(error, '同步数据')

    expect(message).toContain('当前账号没有访问这个 WebDAV 目录的权限')
    expect(message).toContain('/remote-root/sync/v1/.cherry-studio-pi-write-test.tmp')
    expect(message).toContain('重新选择一个已存在且可写的目录')
  })
})
