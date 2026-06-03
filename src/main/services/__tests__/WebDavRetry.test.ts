import { describe, expect, it } from 'vitest'

import {
  describeWebDavUserFacingError,
  normalizeWebDavHost,
  runWebDavOperation,
  WebDavOperationError
} from '../WebDavRetry'

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

  it('describes write permission failures as read-only WebDAV endpoints', () => {
    const error = new WebDavOperationError(
      'writing remote sync probe /remote-root/sync/v1/.cherry-studio-pi-write-test.tmp',
      new Error('Invalid response: 403 Forbidden')
    )

    const message = describeWebDavUserFacingError(error, '同步数据')

    expect(message).toContain('WebDAV 服务拒绝写入')
    expect(message).toContain('/remote-root/sync/v1/.cherry-studio-pi-write-test.tmp')
    expect(message).toContain('数据同步需要支持 MKCOL、PUT、DELETE')
  })

  it('describes probe delete failures as missing WebDAV delete permission', () => {
    const error = new WebDavOperationError(
      'deleting Storage v2 sync probe /remote-root/sync/v1/.cherry-studio-pi-storage-write-test.tmp',
      new Error('delete denied')
    )

    const message = describeWebDavUserFacingError(error, '同步数据')

    expect(message).toContain('WebDAV 服务拒绝写入')
    expect(message).toContain('/remote-root/sync/v1/.cherry-studio-pi-storage-write-test.tmp')
    expect(message).toContain('数据同步需要支持 MKCOL、PUT、DELETE')
  })

  it('keeps missing WebDAV delete support actionable', () => {
    const message = describeWebDavUserFacingError(
      new Error(
        '当前 WebDAV 客户端不支持删除远端文件，无法保证同步目录文件数量收敛。请更换 WebDAV 服务或升级客户端后重试。'
      ),
      '同步数据'
    )

    expect(message).toContain('当前 WebDAV 客户端不支持删除远端文件')
    expect(message).toContain('无法保证同步目录文件数量收敛')
  })

  it('times out stalled WebDAV operations instead of waiting forever', async () => {
    await expect(
      runWebDavOperation('reading remote json /sync/v1/manifest.json', () => new Promise(() => undefined), {
        maxAttempts: 1,
        timeoutMs: 1
      })
    ).rejects.toThrow('timed out')
  })

  it('describes concurrent data sync attempts clearly', () => {
    const message = describeWebDavUserFacingError(new Error('Data sync is already running'), '同步数据')

    expect(message).toContain('已有数据同步正在进行')
  })
})
