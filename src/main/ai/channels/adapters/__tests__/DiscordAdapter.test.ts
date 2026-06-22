import { EventEmitter } from 'events'
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
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

class MockWebSocket extends EventEmitter {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static CLOSING = 2

  readyState = MockWebSocket.OPEN
  send = vi.fn()
  close = vi.fn()
}

let mockWsInstance: MockWebSocket | null = null

vi.mock('ws', () => {
  const Ctor = vi.fn().mockImplementation(() => {
    mockWsInstance = new MockWebSocket()
    return mockWsInstance
  })
  Object.assign(Ctor, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: Ctor, WebSocket: Ctor }
})

vi.mock('@main/utils/downloadAsBase64', () => ({
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  downloadFileAsBase64: vi.fn(),
  downloadImageAsBase64: vi.fn()
}))

import '../discord/DiscordAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const calls = vi.mocked(registerAdapterFactory).mock.calls
  const discordCall = calls.find((c) => c[0] === 'discord')
  if (!discordCall) throw new Error('registerAdapterFactory was not called for discord')
  return discordCall[1] as (channel: any, agentId: string) => any
}

function createAdapter(overrides: Record<string, unknown> = {}) {
  const factory = getFactory()
  return factory(
    {
      id: (overrides.channelId as string) ?? 'ch-discord-1',
      type: 'discord',
      enabled: true,
      config: {
        bot_token: (overrides.bot_token as string) ?? 'discord-token',
        allowed_channel_ids: (overrides.allowed_channel_ids as string[]) ?? ['C0ALLOWED']
      }
    },
    (overrides.agentId as string) ?? 'agent-1'
  )
}

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  } as unknown as Response
}

describe('DiscordAdapter', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
    mockNetFetch.mockResolvedValue(mockJsonResponse({ url: 'wss://discord.test/gateway' }))
    mockWsInstance = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers itself as a discord adapter factory', () => {
    const calls = vi.mocked(registerAdapterFactory).mock.calls
    expect(calls.some((c) => c[0] === 'discord')).toBe(true)
  })

  it('sets notifyChatIds from allowed_channel_ids', () => {
    const adapter = createAdapter({ allowed_channel_ids: ['C1', 'C2'] })
    expect(adapter.notifyChatIds).toEqual(['C1', 'C2'])
  })

  it('schedules heartbeat timers when the gateway sends hello', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const adapter = createAdapter()
    const ws = new MockWebSocket()
    adapter.ws = ws

    try {
      adapter.handleHello({ heartbeat_interval: 1000 })
      expect(vi.getTimerCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(0)
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"op":1'))
      expect(vi.getTimerCount()).toBe(1)

      await adapter.disconnect()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('replaces existing heartbeat timers when the gateway sends duplicate hello', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const adapter = createAdapter()
    const ws = new MockWebSocket()
    adapter.ws = ws

    try {
      adapter.handleHello({ heartbeat_interval: 1000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(1)

      adapter.handleHello({ heartbeat_interval: 1000 })
      expect(vi.getTimerCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(0)
      expect(ws.send).toHaveBeenCalledTimes(4)
      expect(vi.getTimerCount()).toBe(1)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('clears a pending reconnect timer on disconnect', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()

    adapter.scheduleReconnect()
    expect(vi.getTimerCount()).toBe(1)

    await adapter.disconnect()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores close events from a stale WebSocket after reconnect replacement', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    adapter.getGatewayUrl = vi.fn().mockResolvedValue('wss://discord.test/gateway')

    await adapter.startGateway()
    const staleWs = mockWsInstance!

    await adapter.startGateway()

    expect(staleWs.close).toHaveBeenCalled()
    staleWs.emit('close', 1000, Buffer.from('replaced'))

    expect(vi.getTimerCount()).toBe(0)
  })
})
