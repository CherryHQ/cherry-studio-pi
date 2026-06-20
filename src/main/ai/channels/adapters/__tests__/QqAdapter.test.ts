import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

const mockNetFetch = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

vi.mock('ws', () => {
  const Ctor = vi.fn()
  Object.assign(Ctor, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: Ctor, WebSocket: Ctor }
})

import '../qq/QqAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

// Capture the factory at module load — `registerAdapterFactory('qq', …)` runs once on import,
// and afterEach's restoreAllMocks would otherwise wipe that call history before later tests.
const qqCall = vi.mocked(registerAdapterFactory).mock.calls.find((c) => c[0] === 'qq')
if (!qqCall) throw new Error('registerAdapterFactory was not called for qq')
const qqFactory = qqCall[1] as (channel: any, agentId: string) => any
const TEST_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024

function mockBinaryResponse(buf: Buffer, contentType = 'image/png'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } as unknown as Response
}

function createAdapter() {
  return qqFactory(
    { id: 'ch-qq-1', type: 'qq', enabled: true, config: { app_id: 'app', client_secret: 'sec', allowed_chat_ids: [] } },
    'agent-1'
  )
}

describe('QqAdapter.downloadAttachments', () => {
  beforeEach(() => mockNetFetch.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('rejects an SSRF target before any (token-bearing) fetch (C8)', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')

    const result = await adapter.downloadAttachments([
      { url: 'http://169.254.169.254/latest/meta-data/', content_type: 'image/png', filename: 'meta' }
    ])

    expect(result).toEqual({})
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('downloads a public attachment URL', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    mockNetFetch.mockResolvedValue(mockBinaryResponse(Buffer.from('img'), 'image/png'))

    const result = await adapter.downloadAttachments([
      { url: 'https://gchat.qpic.cn/a.png', content_type: 'image/png', filename: 'a.png' }
    ])

    expect(result.images).toHaveLength(1)
    expect(mockNetFetch).toHaveBeenCalled()
    expect(mockNetFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('skips an oversized streamed attachment when content-length is missing', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const arrayBuffer = vi.fn()
    mockNetFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
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
    } as unknown as Response)

    const result = await adapter.downloadAttachments([
      { url: 'https://gchat.qpic.cn/huge.png', content_type: 'image/png', filename: 'huge.png' }
    ])

    expect(result).toEqual({})
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('keeps only one heartbeat interval across duplicate HELLO payloads', async () => {
    vi.useFakeTimers()
    try {
      const adapter = createAdapter()
      vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
      const heartbeatSpy = vi.spyOn(adapter, 'sendHeartbeat').mockImplementation(() => {})

      await adapter.handleHello({ heartbeat_interval: 1000 })
      await adapter.handleHello({ heartbeat_interval: 1000 })

      vi.advanceTimersByTime(1000)

      expect(heartbeatSpy).toHaveBeenCalledTimes(1)

      adapter.cleanup()
      vi.advanceTimersByTime(1000)

      expect(heartbeatSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
