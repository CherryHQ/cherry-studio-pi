import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNetFetch = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/services/storageV2/SecretVaultService', () => ({
  storageV2SecretVaultService: {
    getSecret: vi.fn(),
    setSecret: vi.fn()
  }
}))

vi.mock('@main/services/storageV2/StorageV2Repositories', () => ({
  storageV2SettingsRepository: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

import { WeixinBot } from '../wechat/WeChatProtocol'

const TEST_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024

function mockOversizedStreamResponse(): {
  response: Response
  cancel: ReturnType<typeof vi.fn>
  releaseLock: ReturnType<typeof vi.fn>
  arrayBuffer: ReturnType<typeof vi.fn>
} {
  const cancel = vi.fn().mockResolvedValue(undefined)
  const releaseLock = vi.fn()
  const arrayBuffer = vi.fn()
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/octet-stream' }),
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValueOnce({
          done: false,
          value: { byteLength: TEST_ATTACHMENT_MAX_BYTES + 1 }
        }),
        cancel,
        releaseLock
      })
    },
    arrayBuffer
  } as unknown as Response

  return { response, cancel, releaseLock, arrayBuffer }
}

describe('WeChatProtocol CDN downloads', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
  })

  it('skips an oversized streamed image download when content-length is missing', async () => {
    const { response, cancel, releaseLock, arrayBuffer } = mockOversizedStreamResponse()
    mockNetFetch.mockResolvedValue(response)
    const bot = new WeixinBot()

    const result = await bot.downloadImage({
      media: { encrypt_query_param: 'encrypted-query' },
      aeskey: '00112233445566778899aabbccddeeff'
    } as any)

    expect(result).toBeNull()
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})
