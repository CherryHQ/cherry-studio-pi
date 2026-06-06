import type { MCPServer } from '@renderer/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncAi302Servers } from '../302ai'

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response
}

describe('syncAi302Servers', () => {
  afterEach(() => {
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
    ] satisfies Partial<MCPServer>[]

    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ mcps: fetchedServers }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncAi302Servers('api-key', [
      {
        id: '@302ai/existing-server',
        name: 'existing-server',
        type: 'sse',
        baseUrl: 'https://old.example.com',
        isActive: true
      } as MCPServer
    ])

    expect(result.success).toBe(true)
    expect(result.addedServers).toHaveLength(1)
    expect(result.updatedServers).toHaveLength(1)
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
})
