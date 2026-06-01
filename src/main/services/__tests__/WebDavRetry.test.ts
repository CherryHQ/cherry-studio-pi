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
})
