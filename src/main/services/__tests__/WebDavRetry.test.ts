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

  it('recognizes bare HTTP status errors from WebDAV clients', () => {
    const message = describeWebDavUserFacingError(new Error('503 Service Unavailable'), '同步数据')

    expect(message).toContain('WebDAV 服务暂时不可用')
    expect(message).not.toContain('发生未知错误')
  })

  it('recognizes structured WebDAV response status errors', () => {
    const error = new WebDavOperationError('listing remote directory /dav', {
      response: {
        status: 503,
        statusText: 'Service Unavailable'
      }
    })

    expect(error.message).toContain('503 Service Unavailable')
    expect(error.transient).toBe(true)
    expect(describeWebDavUserFacingError(error, '同步数据')).toContain('WebDAV 服务暂时不可用')
  })

  it('keeps structured WebDAV network errors actionable', () => {
    const message = describeWebDavUserFacingError(
      {
        error: {
          message: 'getaddrinfo ENOTFOUND openapi.alipan.com'
        }
      },
      '同步数据'
    )

    expect(message).toContain('无法解析 WebDAV 地址')
    expect(message).not.toContain('发生未知错误')
    expect(message).not.toContain('[object Object]')
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

  it('describes WebDAV precondition failures as directory or lock compatibility issues', () => {
    const error = new WebDavOperationError(
      'creating remote directory /remote-root/sync/v1/storage-v2/secrets',
      new Error('Invalid response: 412 Precondition Failed')
    )

    const message = describeWebDavUserFacingError(error, '同步数据')

    expect(message).toContain('前置条件失败')
    expect(message).toContain('/remote-root/sync/v1/storage-v2/secrets')
    expect(message).toContain('WebDAV 锁或目录创建语义')
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

  it('keeps Storage v2 sync protocol failures visible instead of replacing them with a generic message', () => {
    const message = describeWebDavUserFacingError(
      new Error(
        '远端 Storage v2 记录 settings:theme 无法写入本地数据库。为避免把未恢复的数据误判为同步成功，本次同步已停止：SQLITE_CONSTRAINT'
      ),
      '同步数据'
    )

    expect(message).toContain('远端 Storage v2 记录 settings:theme 无法写入本地数据库')
    expect(message).toContain('SQLITE_CONSTRAINT')
    expect(message).not.toContain('发生未知错误')
  })

  it('keeps local Storage v2 integrity failures actionable', () => {
    const message = describeWebDavUserFacingError(
      new Error(
        'Storage v2 记录引用了本机和远端都不存在的敏感配置：provider:provider-1:apiKey。请重新保存对应模型、服务或设置后再同步，避免发布缺少密钥的配置。'
      ),
      '同步数据'
    )

    expect(message).toContain('本机和远端都不存在的敏感配置')
    expect(message).toContain('请重新保存对应模型、服务或设置后再同步')
    expect(message).not.toContain('发生未知错误')
  })

  it('times out stalled WebDAV operations instead of waiting forever', async () => {
    await expect(
      runWebDavOperation('reading remote json /sync/v1/manifest.json', () => new Promise(() => undefined), {
        maxAttempts: 1,
        timeoutMs: 1
      })
    ).rejects.toThrow('timed out')
  })

  it('aborts stalled WebDAV operations without waiting for retries or timeouts', async () => {
    const controller = new AbortController()
    const operation = runWebDavOperation(
      'reading remote json /sync/v1/manifest.json',
      () => new Promise(() => undefined),
      {
        maxAttempts: 3,
        timeoutMs: 60_000,
        signal: controller.signal
      }
    )

    controller.abort(new Error('agent cancelled WebDAV request'))

    await expect(operation).rejects.toThrow('agent cancelled WebDAV request')
  })

  it('normalizes invalid retry options instead of skipping the WebDAV operation', async () => {
    await expect(
      runWebDavOperation('reading remote json /sync/v1/manifest.json', async () => 'ok', {
        maxAttempts: Number.NaN,
        initialDelayMs: Number.NaN,
        timeoutMs: Number.NaN
      })
    ).resolves.toBe('ok')
  })

  it('uses a readable fallback when WebDAV clients reject with empty errors', () => {
    const nullError = new WebDavOperationError('reading remote json /sync/v1/manifest.json', null)
    const blankError = new WebDavOperationError('reading remote json /sync/v1/manifest.json', new Error('   '))

    expect(nullError.message).toContain('Unknown WebDAV error')
    expect(blankError.message).toContain('Unknown WebDAV error')
    expect(nullError.message).not.toContain('null')
    expect(blankError.message).not.toContain('   ')
  })

  it('describes concurrent data sync attempts clearly', () => {
    const message = describeWebDavUserFacingError(new Error('Data sync is already running'), '同步数据')

    expect(message).toContain('已有数据同步正在进行')
  })
})
