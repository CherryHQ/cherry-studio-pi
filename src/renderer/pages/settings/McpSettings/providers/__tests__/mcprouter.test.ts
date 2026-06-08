import { APP_NAME } from '@shared/config/constant'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncMcpRouterServers } from '../mcprouter'

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response
}

describe('syncMcpRouterServers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('identifies Cherry Studio Pi in provider discovery headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({
        data: {
          servers: [
            {
              name: 'memory',
              title: 'Memory',
              description: 'Persistent memory server',
              server_key: 'memory',
              config_name: 'memory',
              server_url: 'https://api.mcprouter.to/mcp/memory',
              created_at: '2026-06-08T00:00:00.000Z',
              updated_at: '2026-06-08T00:00:00.000Z'
            }
          ]
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncMcpRouterServers('router-token')

    expect(result.success).toBe(true)
    expect(result.allServers).toHaveLength(1)
    expect(result.allServers[0]).toMatchObject({
      id: '@mcprouter/memory',
      name: 'Memory',
      baseUrl: 'https://api.mcprouter.to/mcp/memory'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mcprouter.to/v1/list-servers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer router-token',
          'X-Title': APP_NAME
        })
      })
    )
  })
})
