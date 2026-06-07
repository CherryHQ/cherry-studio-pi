import type { McpServer } from '@renderer/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncAi302Servers } from '../302ai'
import { MCP_PROVIDER_SYNC_TIMEOUT_MS } from '../request'

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response
}

describe('syncAi302Servers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns every fetched server in allServers', async () => {
    const fetchedServers = [
      {
        name: 'new-server',
        description: 'new description',
        type: 'streamableHttp',
        baseUrl: 'https://api.302.ai/new',
        isActive: true,
        provider: '302ai',
        providerUrl: 'https://302.ai/new',
        tags: ['search'],
        logoUrl: 'https://302.ai/logo.png'
      },
      {
        name: 'existing-server',
        description: 'updated description',
        type: 'sse',
        baseUrl: 'https://api.302.ai/existing',
        isActive: true,
        provider: '302ai',
        providerUrl: 'https://302.ai/existing',
        tags: ['docs'],
        logoUrl: ''
      }
    ] satisfies Partial<McpServer>[]

    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ mcps: fetchedServers }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncAi302Servers('api-key')

    expect(result.success).toBe(true)
    expect(result.allServers).toHaveLength(2)
    expect(result.allServers.map((server) => server.id)).toEqual(['@302ai/new-server', '@302ai/existing-server'])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/mcps/list'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'api-key'
        })
      })
    )
  })

  it('returns a failure instead of hanging when the provider request stalls', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = syncAi302Servers('api-key')
    await vi.advanceTimersByTimeAsync(MCP_PROVIDER_SYNC_TIMEOUT_MS)
    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.allServers).toEqual([])
    expect(result.errorDetails).toContain('timed out')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/mcps/list'),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })
})
