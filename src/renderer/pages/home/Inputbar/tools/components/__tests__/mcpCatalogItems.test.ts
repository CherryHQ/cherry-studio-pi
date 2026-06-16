import { describe, expect, it, vi } from 'vitest'

import { listMcpCatalogItems } from '../mcpCatalogItems'

describe('listMcpCatalogItems', () => {
  it('keeps successful server items when another server fails', async () => {
    const logger = { warn: vi.fn() }
    const failure = new Error('server offline')
    const listItems = vi.fn(async (serverId: string) => {
      if (serverId === 'broken') {
        throw failure
      }

      return [{ id: `${serverId}-item` }]
    })

    const items = await listMcpCatalogItems(
      [
        { id: 'alpha', name: 'Alpha' },
        { id: 'broken', name: 'Broken' },
        { id: 'beta', name: 'Beta' }
      ],
      listItems,
      { kind: 'prompts', logger }
    )

    expect(items).toEqual([{ id: 'alpha-item' }, { id: 'beta-item' }])
    expect(listItems).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledWith('Failed to load MCP prompts', {
      error: failure,
      serverId: 'broken',
      serverName: 'Broken'
    })
  })

  it('preserves fulfilled server order', async () => {
    const items = await listMcpCatalogItems(
      [{ id: 'first' }, { id: 'second' }],
      async (serverId) => (serverId === 'first' ? ['a', 'b'] : ['c']),
      { kind: 'resources' }
    )

    expect(items).toEqual(['a', 'b', 'c'])
  })
})
